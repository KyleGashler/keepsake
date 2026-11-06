import { z } from "zod";

export interface MediaHost {
  /** `corsOrigin` is the web origin allowed to PUT, or `*` for native clients. */
  createUpload: (input: { type: "AUDIO" | "VIDEO"; corsOrigin: string; passthrough: string }) => Promise<HostUpload>;
  getUpload: (uploadId: string) => Promise<HostUpload>;
  getAsset: (assetId: string) => Promise<AssetSnapshot>;
  generateSubtitles: (assetId: string, audioTrackId: string) => Promise<string[]>;
  /** Mux requires an errored caption track be removed before that language can be generated again. */
  deleteFailedCaptionTrack: (assetId: string, trackId: string) => Promise<void>;
  /** Only the `media.purge` job calls this; a clip exists only on the host. */
  deleteAsset: (assetId: string) => Promise<void>;
  cancelUpload: (uploadId: string) => Promise<void>;
  fetchTranscript: (playbackId: string, trackId: string) => Promise<string>;
  playbackUrl: (playbackId: string, kind: "hls" | "audio", durationS: number | null) => Promise<string>;
  posterUrl: (playbackId: string, durationS: number | null) => Promise<string>;
  /** Mux may answer 404/412 just after an asset is ready; those throw a retryable `MediaHostError`. */
  fetchPoster: (playbackId: string, durationS: number | null, width: number) => Promise<Buffer>;
  /** Include the extension in `filename`: without one Mux names the file `.mp4`. */
  audioDownloadUrl: (playbackId: string, filename: string) => Promise<string>;
  /** Mux serves the master for 24 hours and refuses a second request while one exists; `requested` is false then. */
  requestMaster: (assetId: string) => Promise<{ requested: boolean; master: HostMaster | null }>;
}

export interface HostMaster {
  /** Mux: preparing, ready, errored */
  status: string;
  /** Signed: append `download=<filename>` and change nothing else. */
  url: string | null;
}

export interface HostUpload {
  id: string;
  /** Mux: waiting, asset_created, errored, cancelled, timed_out */
  status: string;
  url: string | null;
  assetId: string | null;
  passthrough: string | null;
  error: string | null;
}

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
const masterSchema = z.object({ status: text, url: text });

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
  master_access: text,
  master: masterSchema.nullish(),
});

export type AssetSnapshot = z.infer<typeof assetSnapshotSchema>;

export class MediaHostUnavailableError extends Error {
  constructor(message = "Video and audio uploads are not configured on this server") {
    super(message);
    this.name = "MediaHostUnavailableError";
  }
}

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
