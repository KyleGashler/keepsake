import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PURGE_MAX_ATTEMPTS } from "../lib/purge.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { isOriginalKey } from "../storage/StorageProvider.js";
import type { JobHandler, JobQueue } from "./JobQueue.js";
import { renderAndStore } from "./media-derive.js";

/**
 * `image.derive`: THUMB (400 px) and DISPLAY (1600 px) for a picture that
 * isn't a Media row — a child's profile photo (`Person.photoKey`) or a
 * Library pillar cover (`PillarCover.storageKey`). Same rendering and same
 * keys as `media.derive` (`<familyId>/<uploadId>/thumb.jpg`, `display.jpg`,
 * beside the original, which is only read); no EXIF date or palette, since
 * nothing here uses them.
 *
 * The job is keyed by the storage key, not by the row: once the files are
 * written, every person and cover in the family still pointing at that key
 * is marked derived (`photoDerivedKey` / `derivedKey` = the key), which is
 * what lets the DTOs serve the renditions instead of the original.
 *
 * Idempotent: when every row pointing at the key is already marked, it
 * does nothing, and a re-render replaces the same two files. A photo
 * replaced or a person deleted while this ran leaves no row to mark; the
 * files just written then go to `media.purge`, which keeps any a row still
 * uses (media-purge.ts).
 */
export function imageDeriveHandler(queue: JobQueue): JobHandler<"image.derive"> {
  return {
    async run({ familyId, storageKey: key }, ctx) {
      if (!isOriginalKey(key) || !keyBelongsTo(key, familyId)) {
        ctx.log.error({ key, familyId }, "image.derive: not an original in the family's prefix; skipped");
        return;
      }

      const [people, covers] = await Promise.all([
        prisma.person.findMany({ where: { familyId, photoKey: key }, select: { photoDerivedKey: true } }),
        prisma.pillarCover.findMany({ where: { familyId, storageKey: key }, select: { derivedKey: true } }),
      ]);
      if (people.length + covers.length === 0) return; // replaced or deleted before we got here
      if (people.every((p) => p.photoDerivedKey === key) && covers.every((c) => c.derivedKey === key)) return;

      const { rendered, written } = await renderAndStore(key);

      // Conditional on the key, so a photo replaced mid-render isn't marked
      // with renditions of the one before it.
      const [marked, markedCovers] = await prisma.$transaction([
        prisma.person.updateMany({ where: { familyId, photoKey: key }, data: { photoDerivedKey: key } }),
        prisma.pillarCover.updateMany({ where: { familyId, storageKey: key }, data: { derivedKey: key } }),
      ]);

      if (marked.count + markedCovers.count === 0) {
        // The replace's (or delete's) purge may already have run, so these
        // files would outlive it. Purge them the same way.
        await queue.enqueue(
          "media.purge",
          { familyId, storageKeys: written, muxAssets: [], reason: "renditions of a replaced picture" },
          { maxAttempts: PURGE_MAX_ATTEMPTS },
        );
        return;
      }

      ctx.log.info(
        { key, people: marked.count, covers: markedCovers.count, sizes: rendered.renditions.map((r) => `${r.kind}:${r.width}x${r.height}`) },
        "picture derived",
      );
    },

    async onFinalFailure({ storageKey }, err, ctx) {
      // The picture still shows (as its original).
      ctx.log.error({ storageKey, err }, "image.derive gave up; the original is served in place of renditions");
    },
  };
}

/** Queue `image.derive` for a profile photo or cover just set, in the caller's transaction. */
export function enqueueImageDerive(queue: JobQueue, db: Prisma.TransactionClient, familyId: string, storageKey: string) {
  return queue.enqueue("image.derive", { familyId, storageKey }, { db });
}
