import { prisma } from "../lib/prisma.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { MediaHostError, mediaHost, type HostUpload, type MediaHost } from "../media-host/index.js";
import { storage } from "../storage/index.js";
import { StorageKeyError } from "../storage/StorageProvider.js";
import type { JobHandler } from "./JobQueue.js";

/**
 * `media.purge`: remove for good the files behind rows a family deleted
 * (see lib/purge.ts for when it's enqueued and what the payload holds).
 *
 * Storage first, then Mux; every step is idempotent (an object or asset
 * that's already gone counts as purged), so a retry simply runs the whole
 * list again. Anything that fails is thrown and the queue retries it with
 * backoff — a missing Mux configuration or a token without delete
 * permission included, because those get fixed and the purge must not be
 * lost. Two things are skipped rather than retried, with a log line: a key
 * outside the family's prefix (never ours to delete) and a key some row
 * still points at (another memory, a profile photo, a cover).
 */
export function mediaPurgeHandler(): JobHandler<"media.purge"> {
  return {
    async run({ familyId, storageKeys, muxAssets, reason }, ctx) {
      let purged = 0;
      for (const key of storageKeys) {
        if (!keyBelongsTo(key, familyId)) {
          ctx.log.error({ key, familyId }, "media.purge: key outside the family's prefix; skipped");
          continue;
        }
        if (await stillReferenced(key)) {
          ctx.log.warn({ key }, "media.purge: key is still referenced; kept");
          continue;
        }
        try {
          await storage().purgeForFamilyDelete(key);
        } catch (err) {
          if (err instanceof StorageKeyError) {
            ctx.log.error({ key, err: err.message }, "media.purge: malformed key; skipped");
            continue;
          }
          throw err;
        }
        purged++;
      }

      if (muxAssets.length) {
        const host = mediaHost();
        // Retried, not dropped: the clips are still on Mux until this runs.
        if (!host) throw new Error(`Mux is not configured (MUX_* env unset); ${muxAssets.length} clip(s) wait to be purged`);
        for (const clip of muxAssets) await purgeClip(host, clip.uploadId, clip.assetId);
      }

      ctx.log.info(
        { reason, familyId, objects: purged, ofKeys: storageKeys.length, muxAssets: muxAssets.length },
        "media purged",
      );
    },

    async onFinalFailure(payload, err, ctx) {
      // The Job row keeps the payload: re-queue it once the cause is fixed.
      ctx.log.error({ err, payload }, "media.purge gave up; the files are still stored");
    },
  };
}

/** True when any row still points at `key`. Keys are unique per upload, but a client may reuse one. */
async function stillReferenced(key: string) {
  const [media, derivatives, people, covers] = await Promise.all([
    prisma.media.count({ where: { storageKey: key } }),
    prisma.derivative.count({ where: { storageKey: key } }),
    prisma.person.count({ where: { photoKey: key } }),
    prisma.pillarCover.count({ where: { storageKey: key } }),
  ]);
  return media + derivatives + people + covers > 0;
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
