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

export const SYNC_GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

export function nextPollDelayMs(elapsedMs: number) {
  if (elapsedMs < 2 * 60_000) return 3_000;
  if (elapsedMs < 15 * 60_000) return 10_000;
  if (elapsedMs < 60 * 60_000) return 30_000;
  return 2 * 60_000;
}

// Polling is the safety net for missed webhooks, and the only mechanism in
// development, where Mux can't reach the server.
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
      await updateMuxAsset({ id: muxAssetId }, giveUpPatch);
    },
  };
}
