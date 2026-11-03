import { deleteIfUnused } from "../lib/pictures.js";
import { prisma } from "../lib/prisma.js";
import { MediaHostError, mediaHost, type HostUpload, type MediaHost } from "../media-host/index.js";
import { storage } from "../storage/index.js";
import type { JobHandler } from "./JobQueue.js";

/**
 * `media.purge`: remove for good the files behind rows a family deleted
 * (see lib/purge.ts for when it's enqueued and what the payload holds), or
 * of a profile photo or cover that was replaced or cleared (lib/pictures.ts).
 *
 * Storage first, then Mux; every step is idempotent (an object or asset
 * that's already gone counts as purged), so a retry simply runs the whole
 * list again. Anything that fails is thrown and the queue retries it with
 * backoff — a missing Mux configuration or a token without delete
 * permission included, because those get fixed and the purge must not be
 * lost. The storage keys go to `deleteIfUnused`, which decides what is
 * still in use. Two things are skipped rather than retried, with a log
 * line: a key outside the family's prefix (never ours to delete) and a key
 * something still holds (another memory, a profile photo, a cover).
 *
 * A `wholeFamily` purge (the family itself was deleted) also clears the
 * family's whole storage prefix. Neither check above stands in its way once
 * the Family row is gone: the prefix test is on the key's text, and no row
 * can still point at a key of a family whose rows all cascaded away.
 */
export function mediaPurgeHandler(): JobHandler<"media.purge"> {
  return {
    async run({ familyId, storageKeys, muxAssets, reason, wholeFamily }, ctx) {
      if (wholeFamily) {
        // Belt and braces: a prefix purge of a family that still exists
        // would take every photo it has. Family ids are never reused, so a
        // row here means a bug upstream, not a race worth retrying.
        if (await prisma.family.count({ where: { id: familyId } })) {
          ctx.log.error({ familyId, reason }, "media.purge: wholeFamily purge of a family that still exists; storage skipped");
        } else {
          await storage().purgeFamilyObjects(familyId);
        }
      }

      const { deleted, kept, refused } = await deleteIfUnused(familyId, storageKeys);
      if (refused.length) ctx.log.error({ keys: refused, familyId }, "media.purge: not storage keys of this family's; skipped");
      if (kept.length) ctx.log.warn({ keys: kept }, "media.purge: still held; kept");

      if (muxAssets.length) {
        const host = mediaHost();
        // Retried, not dropped: the clips are still on Mux until this runs.
        if (!host) throw new Error(`Mux is not configured (MUX_* env unset); ${muxAssets.length} clip(s) wait to be purged`);
        for (const clip of muxAssets) await purgeClip(host, clip.uploadId, clip.assetId);
      }

      ctx.log.info(
        { reason, familyId, objects: deleted.length, ofKeys: storageKeys.length, muxAssets: muxAssets.length, wholeFamily },
        "media purged",
      );
    },

    async onFinalFailure(payload, err, ctx) {
      // The Job row keeps the payload: re-queue it once the cause is fixed.
      ctx.log.error({ err, payload }, "media.purge gave up; the files are still stored");
    },
  };
}

/**
 * Delete a clip's asset, whichever ids we have. The upload is read too: it
 * may have become an asset since the row last heard (the asset id we have is
 * null, or stale), and an upload still `waiting` is cancelled so the bytes,
 * if they ever arrive, never become one.
 */
async function purgeClip(host: MediaHost, uploadId: string, assetId: string | null) {
  const assets = new Set(assetId ? [assetId] : []);
  let upload: HostUpload | null = null;
  try {
    upload = await host.getUpload(uploadId);
  } catch (err) {
    // Mux forgets old uploads; with no upload there's nothing to cancel.
    if (!(err instanceof MediaHostError && err.status === 404)) throw err;
  }
  if (upload?.assetId) assets.add(upload.assetId);
  if (upload?.status === "waiting") await host.cancelUpload(uploadId);
  for (const id of assets) await host.deleteAsset(id);
}
