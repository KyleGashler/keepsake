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

export type PictureSize = PhotoDerivativeKind;

type MediaHolder = { storageKey: string | null; derivatives: { kind: string; storageKey: string }[] };
type PersonHolder = { photoKey: string | null; photoDerivedKey: string | null };
type CoverHolder = { storageKey: string; derivedKey: string | null };

export type PictureHolder = MediaHolder | PersonHolder | CoverHolder;

export type HolderRef = { personId: string } | { pillar: Pillar };

export type SetPictureResult = { ok: true } | { ok: false; problem: ImageKeyProblem };

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
  return derivedKey === key && isOriginalKey(key) ? derivativeKey(key, size) : key;
}

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

// Conditional on the key, so a Holder that moved on mid-render isn't marked. When none is
// marked, a replace's delete may already have run, so the files are queued for deletion.
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
  deleted: string[];
  kept: string[];
  refused: string[];
};

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

// Profile photos and covers have no row per Rendition: one is held by whatever holds its Original.
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

function folderOf(key: string) {
  return key.slice(0, key.lastIndexOf("/") + 1);
}

// Keyed by folder so an Original and its Renditions share one lock. Lock order: the Holder's
// row (`lockHolder`) first, then this. Nothing takes them the other way round.
async function lockPicture(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`picture:${folderOf(key)}`}, 0))`;
}

// A cover may have no row yet, so covers lock the Family row instead; `FOR NO KEY UPDATE`
// doesn't block inserts that reference it.
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

export function queueDeleteIfUnused(db: Prisma.TransactionClient, familyId: string, storageKeys: string[], reason: string) {
  return jobQueue().enqueue("media.purge", { familyId, storageKeys, muxAssets: [], reason }, { db });
}
