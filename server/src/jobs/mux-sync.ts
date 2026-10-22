import type { MuxAsset } from "@prisma/client";
import {
  continueSync,
  giveUpPatch,
  isSettled,
  snapshotPatch,
  transcriptPatch,
  updateMuxAsset,
  uploadPatch,
} from "../media-host/assets.js";
import { MediaHostError, mediaHost } from "../media-host/index.js";
import { prisma } from "../lib/prisma.js";
import { PermanentJobError, type JobHandler, type JobQueue } from "./JobQueue.js";

/**
 * How long a chain of polls keeps looking. Long enough for Mux to transcode
 * and caption a 40-minute clip several times over; past it, whatever is
 * still pending is marked FAILED (a webhook arriving later still fixes it).
 */
export const SYNC_GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

/** Quick at first (a short clip is ready in seconds), then easing off. */
export function nextPollDelayMs(elapsedMs: number) {
  if (elapsedMs < 2 * 60_000) return 3_000;
  if (elapsedMs < 15 * 60_000) return 10_000;
  if (elapsedMs < 60 * 60_000) return 30_000;
  return 2 * 60_000;
}

/**
 * `mux.sync`: ask Mux where one upload stands and merge the answer in.
 *
 * Enqueued at finalize (and poked by webhooks and the transcript retry), it
 * reads the upload until there's an asset, then the asset until it is
 * playable and its caption track is ready, then fetches the transcript text.
 * Each run that finds the asset unsettled queues the next look itself, with
 * a delay that grows with the time since the chain began. That's the safety
 * net for missed webhooks, and the whole mechanism in development, where
 * Mux can't reach the server.
 *
 * Mux errors that a retry can fix (network, 5xx, 429) are thrown, and the
 * queue retries them with its own backoff; anything else is permanent.
 */
export function muxSyncHandler(queue: JobQueue): JobHandler<"mux.sync"> {
  return {
    async run({ muxAssetId, startedAt }, ctx) {
      let row: MuxAsset | null = await prisma.muxAsset.findUnique({ where: { id: muxAssetId } });
      if (!row || isSettled(row)) return;

      if (Date.now() - startedAt > SYNC_GIVE_UP_AFTER_MS) {
        await updateMuxAsset({ id: muxAssetId }, giveUpPatch);
        ctx.log.warn({ muxAssetId }, "mux.sync gave up waiting for the asset to settle");
        return;
      }

      const host = mediaHost();
      if (!host) throw new PermanentJobError("Mux is not configured (MUX_* env unset)");

      try {
        if (!row.assetId) {
          const upload = await host.getUpload(row.uploadId);
          row = await updateMuxAsset({ id: muxAssetId }, (r) => uploadPatch(r, upload));
        }
        if (row?.assetId) {
          const snap = await host.getAsset(row.assetId);
          row = await updateMuxAsset({ id: muxAssetId }, (r) => snapshotPatch(r, snap));

          const trackId = row?.captionTrackId;
          const track = snap.tracks?.find((t) => t.id === trackId);
          if (row?.playbackId && trackId && row.captionStatus === "PENDING" && track?.status === "ready") {
            const text = await host.fetchTranscript(row.playbackId, trackId);
            row = await updateMuxAsset({ id: muxAssetId }, (r) => transcriptPatch(r, trackId, text));
            ctx.log.info({ muxAssetId, chars: text.length }, "transcript fetched from Mux");
          }
        }
      } catch (err) {
        if (err instanceof MediaHostError && !err.retryable) throw new PermanentJobError(err.message, { cause: err });
        throw err;
      }

      if (!row) return;
      if (isSettled(row)) {
        ctx.log.info({ muxAssetId, status: row.status, captions: row.captionStatus }, "mux asset settled");
        return;
      }
      await continueSync(queue, muxAssetId, startedAt, nextPollDelayMs(Date.now() - startedAt));
    },

    async onFinalFailure({ muxAssetId }) {
      // Mux kept refusing (or never answered). Stop showing "Preparing…"
      // forever; a webhook that arrives later still moves it on.
      await updateMuxAsset({ id: muxAssetId }, giveUpPatch);
    },
  };
}
