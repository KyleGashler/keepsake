import express, { Router } from "express";
import { z } from "zod";
import { jobQueue } from "../jobs/index.js";
import { errorMessage } from "../lib/errors.js";
import {
  captionTrackPatch,
  isSettled,
  kickSync,
  renditionPatch,
  snapshotPatch,
  updateMuxAsset,
  uploadPatch,
} from "../media-host/assets.js";
import { assetSnapshotSchema } from "../media-host/MediaHost.js";
import { muxWebhookSecret, verifyMuxWebhook } from "../media-host/index.js";

/**
 * `POST /api/webhooks/mux`. Mounted ahead of `express.json` and auth (see
 * index.ts): the body must stay raw bytes for the signature check, and the
 * signature is the caller's only credential.
 *
 * Every event is merged into the MuxAsset row as facts that can't move
 * backwards (media-host/assets.ts), so a replayed or out-of-order delivery
 * changes nothing. Nothing here calls Mux back: when an event means there is
 * something to fetch (a caption track's text), the `mux.sync` job is poked to
 * do it. Answers 200 for events about uploads this database doesn't know (a
 * different environment sharing the webhook URL, a dashboard test event).
 */
export const muxWebhookRouter = Router();

const uploadData = z.object({
  id: z.string(),
  status: z.string(),
  asset_id: z.string().nullish(),
  error: z.object({ message: z.string().nullish(), type: z.string().nullish() }).nullish(),
});

const trackData = z.object({
  id: z.string(),
  asset_id: z.string(),
  type: z.string().nullish(),
  text_source: z.string().nullish(),
});

const renditionData = z.object({ asset_id: z.string(), name: z.string().nullish() });

muxWebhookRouter.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const secret = muxWebhookSecret();
  if (!secret) {
    // Not an error on Mux's side: answer so it retries once we're configured.
    return res.status(503).json({ error: "Mux webhooks are not configured (MUX_WEBHOOK_SECRET unset)" });
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  let event;
  try {
    event = await verifyMuxWebhook(raw, req.headers, secret);
  } catch (err) {
    req.log.warn({ err: errorMessage(err) }, "rejected Mux webhook");
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  const log = req.log.child({ muxEvent: event.id, muxEventType: event.type });
  const row = await applyEvent(event.type, event.data);
  if (row === undefined) {
    log.debug("Mux webhook ignored");
  } else if (row === null) {
    log.info("Mux webhook for an unknown upload; ignored");
  } else {
    if (!isSettled(row)) await kickSync(jobQueue(), row.id);
    log.info({ muxAssetId: row.id, status: row.status, captions: row.captionStatus }, "Mux webhook applied");
  }
  res.json({ received: true });
});

/**
 * Merge one event into its MuxAsset row. Returns the row after the merge,
 * null when no row matches, undefined for events this app doesn't use.
 */
async function applyEvent(type: string, data: unknown) {
  switch (type) {
    case "video.upload.asset_created":
    case "video.upload.errored":
    case "video.upload.cancelled": {
      const upload = uploadData.parse(data);
      return updateMuxAsset({ uploadId: upload.id }, (r) =>
        uploadPatch(r, {
          status: upload.status,
          assetId: upload.asset_id ?? null,
          error: upload.error?.message ?? upload.error?.type ?? null,
        }),
      );
    }

    case "video.asset.created":
    case "video.asset.ready":
    case "video.asset.errored":
    case "video.asset.updated":
    case "video.asset.static_renditions.ready": {
      const snap = assetSnapshotSchema.parse(data);
      return updateMuxAsset({ assetId: snap.id, uploadId: snap.upload_id }, (r) => snapshotPatch(r, snap));
    }

    case "video.asset.track.ready":
    case "video.asset.track.errored": {
      const track = trackData.parse(data);
      // Only the generated captions matter here; the audio and video tracks
      // arrive with `video.asset.ready`.
      if (track.type !== "text" || track.text_source !== "generated_vod") return undefined;
      const status = type === "video.asset.track.ready" ? "ready" : "errored";
      return updateMuxAsset({ assetId: track.asset_id }, (r) => captionTrackPatch(r, { id: track.id, status }));
    }

    case "video.asset.static_rendition.ready":
    case "video.asset.static_rendition.errored":
    case "video.asset.static_rendition.skipped": {
      const rendition = renditionData.parse(data);
      const status = type.slice("video.asset.static_rendition.".length);
      return updateMuxAsset({ assetId: rendition.asset_id }, (r) => renditionPatch(r, rendition.name, status));
    }

    default:
      return undefined;
  }
}
