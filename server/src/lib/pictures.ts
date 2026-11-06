import type { Pillar, Prisma } from "@prisma/client";
import { jobQueue } from "../jobs/queue.js";
import { READ_URL_TTL_SECONDS, storage } from "../storage/index.js";
import {
  PHOTO_DERIVATIVE_KINDS,
  StorageKeyError,
  assertSafeKey,
  derivativeKey,
  isOriginalKey,
  type PhotoDerivativeKind,
} from "../storage/StorageProvider.js";
import { contentTypeForKey, mediaTypeFor } from "./mime.js";
import { prisma } from "./prisma.js";
import { keyBelongsTo, type ImageKeyProblem } from "./upload-keys.js";

/**
 * Pictures: every rule about a family's still images, in one place.
 *
 * A Picture is an Original (the uploaded file, under
 * `<familyId>/<uploadId>/original.<ext>`) plus its Renditions (`thumb.jpg`
 * and `display.jpg` beside it). Its Holders are a memory's photo (a Media
 * row), a person's profile photo (`Person.photoKey`) and a pillar's cover
 * (`PillarCover.storageKey`); one Original can have several at once.
 *
 * This module is the only code that knows which tables can hold a Picture,
 * which URL to serve for one, when an Original or Rendition is still in use,
 * and how to delete them. Memory photos record their Renditions as
 * `Derivative` rows; profile photos and covers record which key has them
 * (`photoDerivedKey` / `derivedKey`). Callers never see the difference.
 *
 * Out of scope: attaching photos to a memory (`POST /memories`), Mux clips,
 * and deleting a whole family (a prefix purge, lib/purge.ts).
 *
 * Locks. One Postgres advisory transaction lock per Picture, named by its
 * folder (`<familyId>/<uploadId>/`), so an Original and its Renditions share
 * it. Two places take it: `deleteIfUnused`, around "still in use?" and the
 * storage delete, and `setPicture`, around "is the file there?" and writing
 * the Holder row. Either the delete sees the new Holder and keeps the files,
 * or the set finds the file gone and refuses. Lock order, wherever both are
 * taken: the Holder's row (Person `FOR UPDATE`, or the Family row for a
 * cover), then the Picture lock. Nothing takes them the other way round.
 * `POST /memories` takes no lock (a known gap, docs/PLAN.md).
 */

export type PictureSize = PhotoDerivativeKind;

/** A memory's photo: its Media row, with the Renditions `media.derive` recorded. */
type MediaHolder = { storageKey: string | null; derivatives: { kind: string; storageKey: string }[] };
/** A person, for their profile photo. */
type PersonHolder = { photoKey: string | null; photoDerivedKey: string | null };
/** A pillar's cover row. */
type CoverHolder = { storageKey: string; derivedKey: string | null };

export type PictureHolder = MediaHolder | PersonHolder | CoverHolder;

/** Who `setPicture` sets the Picture of. */
export type HolderRef = { personId: string } | { pillar: Pillar };

export type SetPictureResult = { ok: true } | { ok: false; problem: ImageKeyProblem };

/**
 * The best URL for a Holder's Picture at `size`, signed fresh: its Rendition
 * once one exists, else the Original. Null when the Holder has no uploaded
 * Picture (no profile photo; a generated placeholder Media row).
 */
export async function pictureUrl(holder: PictureHolder, size: PictureSize): Promise<string | null> {
  const key = fileToServe(holder, size);
  return key ? storage().getReadUrl(key, READ_URL_TTL_SECONDS) : null;
}

function fileToServe(holder: PictureHolder, size: PictureSize): string | null {
  if ("derivatives" in holder) {
    return holder.derivatives.find((d) => d.kind === size)?.storageKey ?? holder.storageKey;
  }
  const [key, derivedKey] = "photoKey" in holder ? [holder.photoKey, holder.photoDerivedKey] : [holder.storageKey, holder.derivedKey];
  if (!key) return null;
  // Renditions are served only for the very key they were made from.
  return derivedKey === key && isOriginalKey(key) ? derivativeKey(key, size) : key;
}

/**
 * Set, replace or clear (`key` null) a person's profile photo or a pillar's
 * cover, in its own transaction.
 *
 * The key must name an image Original in this family's prefix that is
 * actually stored; else nothing changes and the problem is returned. A
 * replaced or cleared Picture is queued for `deleteIfUnused` (`media.purge`),
 * which deletes its Original and Renditions unless something else still
 * holds them. A new key queues `image.derive` for its Renditions, and so
 * does sending the current key again while it has none (a derive that gave
 * up gets another go). A person who doesn't exist in the family has nothing
 * to set: `{ ok: true }`, nothing written.
 */
export async function setPicture(familyId: string, holder: HolderRef, key: string | null): Promise<SetPictureResult> {
  if (key !== null) {
    const problem = keyShapeProblem(key, familyId);
    if (problem) return { ok: false, problem };
  }

  return prisma.$transaction(
    async (tx): Promise<SetPictureResult> => {
      const before = await lockHolder(tx, familyId, holder);
      if (before === undefined) return { ok: true };

      if (key !== null) {
        await lockPicture(tx, key);
        if (!(await storage().head(key))) return { ok: false, problem: "missing" };
      }

      const oldKey = before?.key ?? null;
      if (oldKey === key) {
        if (key !== null && before?.derivedKey !== key) await queueRenditions(tx, familyId, key);
        return { ok: true };
      }

      await writeHolder(tx, familyId, holder, key);
      if (oldKey !== null) {
        const what = "personId" in holder ? "profile photo" : "pillar cover";
        await queueDeleteIfUnused(tx, familyId, [oldKey], `${key === null ? "removed" : "replaced"} ${what}`);
      }
      if (key !== null) await queueRenditions(tx, familyId, key);
      return { ok: true };
    },
    // The storage `head` runs under the lock.
    { timeout: 30_000 },
  );
}

/**
 * For `image.derive`, before it renders: does any profile photo or cover
 * hold `key` without its Renditions yet? False when every Holder is marked,
 * or nothing holds it any more (replaced or deleted before the job ran).
 */
export async function needsRenditions(familyId: string, key: string): Promise<boolean> {
  // `not: key` alone would skip nulls (SQL's NULL <> key is not true).
  const [people, covers] = await Promise.all([
    prisma.person.count({
      where: { familyId, photoKey: key, OR: [{ photoDerivedKey: null }, { photoDerivedKey: { not: key } }] },
    }),
    prisma.pillarCover.count({
      where: { familyId, storageKey: key, OR: [{ derivedKey: null }, { derivedKey: { not: key } }] },
    }),
  ]);
  return people + covers > 0;
}

/**
 * For `image.derive`, after it wrote `written` (the Renditions of `key`):
 * mark every profile photo and cover still holding `key`, so they serve the
 * Renditions. Conditional on the key, so a Holder that moved on mid-render
 * isn't marked with another Picture's files. When none is marked, the files
 * are queued for `deleteIfUnused`: a replace's delete may already have run,
 * and these would outlive it (a memory photo sharing them keeps them).
 * Returns how many Holders were marked.
 */
export async function renditionsMade(familyId: string, key: string, written: string[]): Promise<number> {
  const [people, covers] = await prisma.$transaction([
    prisma.person.updateMany({ where: { familyId, photoKey: key }, data: { photoDerivedKey: key } }),
    prisma.pillarCover.updateMany({ where: { familyId, storageKey: key }, data: { derivedKey: key } }),
  ]);
  const marked = people.count + covers.count;
  if (marked === 0) await queueDeleteIfUnused(prisma, familyId, written, "renditions of a picture nothing holds");
  return marked;
}

export type DeleteOutcome = {
  /** Files deleted (an Original's Renditions included), or already gone. */
  deleted: string[];
  /** Keys something still holds. */
  kept: string[];
  /** Keys that aren't this family's, or aren't a storage key at all. Never touched. */
  refused: string[];
};

/**
 * For `media.purge`: delete each Original (with its Renditions) or Rendition
 * that nothing holds any more. Each check and its delete run under the
 * Picture's lock, so a `setPicture` racing it either lands first (and the
 * files are kept) or finds them gone. Idempotent: a file already gone counts
 * as deleted. A storage error is thrown, for the queue to retry.
 */
export async function deleteIfUnused(familyId: string, keys: string[]): Promise<DeleteOutcome> {
  const outcome: DeleteOutcome = { deleted: [], kept: [], refused: [] };
  for (const key of new Set(keys)) {
    if (!isSafeKey(key) || !keyBelongsTo(key, familyId)) {
      outcome.refused.push(key);
      continue;
    }
    await prisma.$transaction(
      async (tx) => {
        await lockPicture(tx, key);
        if (await inUse(tx, familyId, key)) {
          outcome.kept.push(key);
          return;
        }
        const files = isOriginalKey(key) ? [key, ...PHOTO_DERIVATIVE_KINDS.map((kind) => derivativeKey(key, kind))] : [key];
        await Promise.all(files.map((file) => storage().purgeForFamilyDelete(file)));
        outcome.deleted.push(...files);
      },
      // The storage delete runs under the lock; on S3 it removes every version.
      { timeout: 60_000 },
    );
  }
  return outcome;
}

/**
 * Whether anything holds `key`. An Original is held by a Media row, a person
 * or a cover pointing at it. A Rendition is held by a `Derivative` row naming
 * it, or by anything holding the Original beside it (profile photos and
 * covers have no row per Rendition).
 */
async function inUse(tx: Prisma.TransactionClient, familyId: string, key: string) {
  const original = isOriginalKey(key) ? key : { startsWith: `${folderOf(key)}original` };
  const [media, people, covers, derivatives] = await Promise.all([
    tx.media.count({ where: { storageKey: original, memory: { familyId } } }),
    tx.person.count({ where: { familyId, photoKey: original } }),
    tx.pillarCover.count({ where: { familyId, storageKey: original } }),
    isOriginalKey(key) ? 0 : tx.derivative.count({ where: { storageKey: key, media: { memory: { familyId } } } }),
  ]);
  return media + people + covers + derivatives > 0;
}

/** The checks that need no storage call: what `setPicture` refuses before it locks anything. */
function keyShapeProblem(key: string, familyId: string): ImageKeyProblem | null {
  if (!isSafeKey(key)) return "malformed";
  if (!keyBelongsTo(key, familyId)) return "foreign";
  if (!isOriginalKey(key)) return "not_an_image";
  const type = contentTypeForKey(key);
  if (type === "application/octet-stream" || mediaTypeFor(type) !== "PHOTO") return "not_an_image";
  return null;
}

function isSafeKey(key: string) {
  try {
    assertSafeKey(key);
    return true;
  } catch (err) {
    if (err instanceof StorageKeyError) return false;
    throw err;
  }
}

/** `<familyId>/<uploadId>/`: what an Original and its Renditions have in common. */
function folderOf(key: string) {
  return key.slice(0, key.lastIndexOf("/") + 1);
}

/** The Picture lock (see the top of this file), held until the transaction ends. */
async function lockPicture(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`picture:${folderOf(key)}`}, 0))`;
}

/**
 * Lock the Holder's row and read what it holds now: its key and the key its
 * Renditions are of, null when it holds nothing, undefined when the person
 * isn't in the family. A cover may have no row yet, so covers lock the
 * Family row (`FOR NO KEY UPDATE`, which doesn't block inserts that
 * reference it) and two first covers can't both miss the other's key.
 */
async function lockHolder(
  tx: Prisma.TransactionClient,
  familyId: string,
  holder: HolderRef,
): Promise<{ key: string | null; derivedKey: string | null } | null | undefined> {
  if ("personId" in holder) {
    const [row] = await tx.$queryRaw<{ photoKey: string | null; photoDerivedKey: string | null }[]>`
      SELECT "photoKey", "photoDerivedKey" FROM "Person"
      WHERE id = ${holder.personId} AND "familyId" = ${familyId} FOR UPDATE`;
    return row ? { key: row.photoKey, derivedKey: row.photoDerivedKey } : undefined;
  }
  const family = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Family" WHERE id = ${familyId} FOR NO KEY UPDATE`;
  if (family.length === 0) return undefined;
  const cover = await tx.pillarCover.findUnique({
    where: { familyId_pillar: { familyId, pillar: holder.pillar } },
    select: { storageKey: true, derivedKey: true },
  });
  return cover ? { key: cover.storageKey, derivedKey: cover.derivedKey } : null;
}

/** Point the Holder at `key` (no Renditions yet), or clear it. */
async function writeHolder(tx: Prisma.TransactionClient, familyId: string, holder: HolderRef, key: string | null) {
  if ("personId" in holder) {
    await tx.person.updateMany({
      where: { id: holder.personId, familyId },
      data: { photoKey: key, photoDerivedKey: null },
    });
    return;
  }
  if (key === null) {
    await tx.pillarCover.deleteMany({ where: { familyId, pillar: holder.pillar } });
    return;
  }
  await tx.pillarCover.upsert({
    where: { familyId_pillar: { familyId, pillar: holder.pillar } },
    create: { familyId, pillar: holder.pillar, storageKey: key },
    update: { storageKey: key, derivedKey: null },
  });
}

function queueRenditions(tx: Prisma.TransactionClient, familyId: string, key: string) {
  return jobQueue().enqueue("image.derive", { familyId, storageKey: key }, { db: tx });
}

/** Queue `deleteIfUnused` for `storageKeys` (a `media.purge`), in `db`'s transaction when it is one. */
export function queueDeleteIfUnused(db: Prisma.TransactionClient, familyId: string, storageKeys: string[], reason: string) {
  return jobQueue().enqueue("media.purge", { familyId, storageKeys, muxAssets: [], reason }, { db });
}
