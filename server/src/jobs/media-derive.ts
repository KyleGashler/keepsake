import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { MAX_DERIVE_BYTES, UndecodableImageError, renderPhoto, type RenderedPhoto } from "../lib/photo-derivatives.js";
import { PURGE_MAX_ATTEMPTS } from "../lib/purge.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { PHOTO_DERIVATIVE_KINDS, derivativeKey, storage } from "../storage/index.js";
import { isOriginalKey } from "../storage/StorageProvider.js";
import { PermanentJobError, type JobHandler, type JobQueue } from "./JobQueue.js";
import { readAll, refreshMemory } from "./memory-refresh.js";

/**
 * `media.derive`: one photo's THUMB (400 px) and DISPLAY (1600 px) JPEGs,
 * written beside its original (`<familyId>/<uploadId>/thumb.jpg`,
 * `display.jpg`), plus its EXIF capture day and upright size on the Media
 * row; then the memory is refreshed (palette, date — see memory-refresh.ts).
 *
 * The original is only ever read. Idempotent: a photo that already has both
 * renditions skips straight to the refresh, and a re-render replaces the
 * same two keys. Bytes that aren't a picture fail at once
 * (`PermanentJobError`); a storage or database error is retried by the queue.
 *
 * Racing a delete: the renditions are written first, then their rows under
 * the Media row's lock. If the photo was deleted meanwhile there's no row to
 * lock, and the files just written are handed to `media.purge`. A delete
 * that lands after the rows commit purges them itself (lib/purge.ts names
 * every original's rendition keys, rows or not).
 */
export function mediaDeriveHandler(queue: JobQueue): JobHandler<"media.derive"> {
  return {
    async run({ familyId, mediaId }, ctx) {
      const media = await prisma.media.findFirst({
        where: { id: mediaId, memory: { familyId } },
        select: { id: true, type: true, storageKey: true, memoryId: true, derivatives: { select: { kind: true } } },
      });
      if (!media) return; // deleted since; its purge took care of the files
      const key = media.storageKey;
      if (media.type !== "PHOTO" || !key || !isOriginalKey(key) || !keyBelongsTo(key, familyId)) {
        ctx.log.info({ mediaId, type: media.type }, "media.derive: not an uploaded photo; nothing to derive");
        return;
      }

      const have = new Set(media.derivatives.map((d) => d.kind));
      if (PHOTO_DERIVATIVE_KINDS.every((k) => have.has(k))) {
        await refreshMemory(familyId, media.memoryId, ctx.log);
        return;
      }

      const head = await storage().head(key);
      if (!head) throw new PermanentJobError(`The original is missing from storage: ${key}`);
      if (head.bytes > MAX_DERIVE_BYTES) {
        throw new PermanentJobError(`Too large to derive (${head.bytes} bytes; the limit is ${MAX_DERIVE_BYTES})`);
      }

      let rendered: RenderedPhoto;
      try {
        rendered = await renderPhoto(await readAll(await storage().stream(key)));
      } catch (err) {
        if (err instanceof UndecodableImageError) throw new PermanentJobError(err.message, { cause: err });
        throw err;
      }

      const written: string[] = [];
      for (const r of rendered.renditions) {
        const at = derivativeKey(key, r.kind);
        await storage().writeDerivative(at, r.body, "image/jpeg");
        written.push(at);
      }

      const kept = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Media" WHERE id = ${mediaId} FOR UPDATE`;
        if (rows.length === 0) return false;
        for (const r of rendered.renditions) {
          const row = { storageKey: derivativeKey(key, r.kind), width: r.width, height: r.height, mimeType: "image/jpeg" };
          await tx.derivative.upsert({
            where: { mediaId_kind: { mediaId, kind: r.kind } },
            create: { mediaId, kind: r.kind, ...row },
            update: row,
          });
        }
        const facts: Prisma.MediaUpdateInput = {};
        // Finalize measured the stored pixels; an EXIF-rotated photo's
        // width and height come out swapped there. These are as it's seen.
        if (rendered.width > 0 && rendered.height > 0) Object.assign(facts, { width: rendered.width, height: rendered.height });
        if (rendered.capturedAt) facts.capturedAt = rendered.capturedAt;
        await tx.media.update({ where: { id: mediaId }, data: facts });
        return true;
      });

      if (!kept) {
        // Deleted while rendering. The delete's purge may already have run,
        // so these files would outlive it; purge them the same way.
        await queue.enqueue(
          "media.purge",
          { familyId, storageKeys: written, muxAssets: [], reason: "derivatives of a deleted photo" },
          { maxAttempts: PURGE_MAX_ATTEMPTS },
        );
        return;
      }

      ctx.log.info(
        { mediaId, capturedAt: rendered.capturedAt?.toISOString() ?? null, sizes: rendered.renditions.map((r) => `${r.kind}:${r.width}x${r.height}`) },
        "photo derived",
      );
      await refreshMemory(familyId, media.memoryId, ctx.log);
    },

    async onFinalFailure({ mediaId }, err, ctx) {
      // The photo still shows (as its original); lists just load it whole.
      ctx.log.error({ mediaId, err }, "media.derive gave up; the original is served in place of renditions");
    },
  };
}

/** Queue `media.derive` for each uploaded photo, in the caller's transaction. */
export async function enqueueDerive(
  queue: JobQueue,
  db: Prisma.TransactionClient,
  familyId: string,
  media: { id: string; type: string; storageKey: string | null }[],
) {
  for (const m of media) {
    if (m.type === "PHOTO" && m.storageKey) await queue.enqueue("media.derive", { familyId, mediaId: m.id }, { db });
  }
}
