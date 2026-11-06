import { deleteIfUnused } from "../lib/pictures.js";
import { prisma } from "../lib/prisma.js";
import { MediaHostError, mediaHost, type HostUpload, type MediaHost } from "../media-host/index.js";
import { storage } from "../storage/index.js";
import type { JobHandler } from "./JobQueue.js";

export function mediaPurgeHandler(): JobHandler<"media.purge"> {
  return {
    async run({ familyId, storageKeys, muxAssets, reason, wholeFamily }, ctx) {
      if (wholeFamily) {
        // A prefix purge of a family that still exists would take every photo it has. Ids are never
        // reused, so a row here is a bug upstream, not a race worth retrying.
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
      ctx.log.error({ err, payload }, "media.purge gave up; the files are still stored");
    },
  };
}

// The upload may have become an asset since the row last heard, and a `waiting` one is cancelled so
// bytes that arrive later never become an asset.
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
