import { z } from "zod";

/**
 * Where video and audio live: a host that takes a direct upload, transcodes
 * it, serves it over signed URLs and writes captions for it. Mux is the only
 * implementation (MuxMediaHost); this interface is the seam that keeps the
 * SDK out of routes and jobs. There is deliberately no local stand-in — dev
 * uses Mux's Development environment, and without credentials the server
 * refuses AV uploads (see `mediaHost()` in ./index.ts).
 *
 * A family's clip exists only on the host, so the app never deletes an asset
 * on its own. `deleteAsset` and `cancelUpload` exist for one caller: the
 * `media.purge` job, after a family explicitly deleted the memory or clip.
 */
export interface MediaHost {
  /**
   * A one-shot upload URL the client PUTs the file to. `passthrough` is
   * recorded on the asset (we use the family id); `corsOrigin` is the web
   * origin allowed to PUT, or `*` for native clients.
   */
  createUpload: (input: { type: "AUDIO" | "VIDEO"; corsOrigin: string; passthrough: string }) => Promise<HostUpload>;
  getUpload: (uploadId: string) => Promise<HostUpload>;
  getAsset: (assetId: string) => Promise<AssetSnapshot>;
  /** Ask for captions again from an asset's audio track. Returns the new text track ids. */
  generateSubtitles: (assetId: string, audioTrackId: string) => Promise<string[]>;
  /**
   * Remove an *errored* generated caption track, which Mux requires before
   * captions in the same language can be generated again. Only ever called
   * on a failed text track: never on an asset, never on audio or video.
   */
  deleteFailedCaptionTrack: (assetId: string, trackId: string) => Promise<void>;
  /**
   * Delete an asset and everything Mux holds for it (master, renditions,
   * captions, playback ids). Resolves when the asset is gone, including when
   * it already was (404). Only the `media.purge` job calls this.
   */
  deleteAsset: (assetId: string) => Promise<void>;
  /**
   * Cancel a direct upload that is still `waiting` for its bytes, so it can
   * never become an asset. Only the `media.purge` job calls this.
   */
  cancelUpload: (uploadId: string) => Promise<void>;
  /** Plain text of a caption track. */
  fetchTranscript: (playbackId: string, trackId: string) => Promise<string>;
  /** Signed HLS (`.m3u8`) for video, or the signed `audio.m4a` rendition for audio. */
  playbackUrl: (playbackId: string, kind: "hls" | "audio", durationS: number | null) => Promise<string>;
  /** Signed poster frame. */
  posterUrl: (playbackId: string, durationS: number | null) => Promise<string>;
}

export interface HostUpload {
  id: string;
  /** waiting, asset_created, errored, cancelled, timed_out */
  status: string;
  /** Where to PUT the bytes (only on a fresh upload). */
  url: string | null;
  assetId: string | null;
  /** The passthrough the upload's asset will carry. */
  passthrough: string | null;
  error: string | null;
}

/**
 * The parts of a Mux asset this app reads, in the shape both the REST API and
 * webhook payloads use. Parsed with zod rather than typed from the SDK so a
 * webhook body (plain JSON) and an API response go through the same door.
 */
const text = z.string().nullish();
const count = z.number().nullish();

const playbackIdSchema = z.object({ id: z.string(), policy: text });

const trackSchema = z.object({
  id: text,
  type: text,
  status: text,
  text_source: text,
  primary: z.boolean().nullish(),
  max_width: count,
  max_height: count,
});

const renditionFileSchema = z.object({ name: text, status: text });
const renditionsSchema = z.object({ files: z.array(renditionFileSchema).nullish() });
const errorsSchema = z.object({ type: text, messages: z.array(z.string()).nullish() });

export const assetSnapshotSchema = z.object({
  id: z.string(),
  status: z.string(),
  upload_id: text,
  passthrough: text,
  duration: count,
  playback_ids: z.array(playbackIdSchema).nullish(),
  tracks: z.array(trackSchema).nullish(),
  static_renditions: renditionsSchema.nullish(),
  errors: errorsSchema.nullish(),
});

export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;

/** The host isn't configured (no credentials) — AV uploads answer 503. */
export class MediaHostUnavailableError extends Error {
  constructor(message = "Video and audio uploads are not configured on this server") {
    super(message);
    this.name = "MediaHostUnavailableError";
  }
}

/**
 * A call to the host failed. `retryable` is false for answers that will not
 * change on a retry (4xx other than 429): bad credentials, an unknown id.
 */
export class MediaHostError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MediaHostError";
  }
}
