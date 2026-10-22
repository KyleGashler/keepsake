import { APIError, Mux } from "@mux/mux-node";
import { z } from "zod";
import { errorMessage } from "../lib/errors.js";
import { READ_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from "../storage/index.js";
import {
  MediaHostError,
  assetSnapshotSchema,
  type AssetSnapshot,
  type HostUpload,
  type MediaHost,
} from "./MediaHost.js";

export interface MuxConfig {
  tokenId: string;
  tokenSecret: string;
  signingKeyId: string;
  /** The URL signing key's private half: a PEM, or (as Mux hands it out) base64 of one. */
  signingKeyPrivate: string;
}

/** Poster frames are drawn at this width; cards and heroes scale them down. */
const POSTER_WIDTH = 1200;

/**
 * How long one signed URL is reused for. Signing per response would give
 * every response a new URL, and a new URL is a cache miss for every poster
 * the client has already drawn. Within this window the same clip gets the
 * same URL; its token is signed to outlive the window by the full TTL.
 */
const TOKEN_REUSE_SECONDS = 10 * 60;
const TOKEN_CACHE_MAX = 5000;

/** Long enough for Mux to answer; a hung request mustn't hold a job forever. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Mux Video through the official SDK: direct uploads, asset reads, caption
 * generation and RS256 playback tokens. Every asset is created with the
 * settings in docs/PLAN.md ("Decision: Mux for video and audio"): signed
 * playback only, basic quality, 1080p cap, auto-language captions, and for
 * audio the `audio.m4a` static rendition so it plays as a plain file.
 */
export class MuxMediaHost implements MediaHost {
  private readonly mux: Mux;
  private readonly tokens = new Map<string, { token: string; reuseUntil: number }>();

  constructor(private readonly config: MuxConfig) {
    this.mux = new Mux({
      tokenId: config.tokenId,
      tokenSecret: config.tokenSecret,
      jwtSigningKey: config.signingKeyId,
      jwtPrivateKey: config.signingKeyPrivate,
      timeout: REQUEST_TIMEOUT_MS,
      // The job queue owns retries and backoff; one place, one policy.
      maxRetries: 0,
    });
  }

  async createUpload({
    type,
    corsOrigin,
    passthrough,
  }: {
    type: "AUDIO" | "VIDEO";
    corsOrigin: string;
    passthrough: string;
  }): Promise<HostUpload> {
    const upload = await call(() =>
      this.mux.video.uploads.create({
        cors_origin: corsOrigin,
        timeout: UPLOAD_URL_TTL_SECONDS,
        new_asset_settings: {
          playback_policies: ["signed"],
          video_quality: "basic",
          max_resolution_tier: "1080p",
          passthrough,
          // For a direct upload the first input has no url: it *is* the upload,
          // and these settings apply to it.
          inputs: [{ generated_subtitles: [{ language_code: "auto", name: "Transcript (generated)" }] }],
          ...(type === "AUDIO" ? { static_renditions: [{ resolution: "audio-only" as const }] } : {}),
        },
      }),
    );
    return toHostUpload(upload);
  }

  async getUpload(uploadId: string): Promise<HostUpload> {
    return toHostUpload(await call(() => this.mux.video.uploads.retrieve(uploadId)));
  }

  async getAsset(assetId: string): Promise<AssetSnapshot> {
    const asset = await call(() => this.mux.video.assets.retrieve(assetId));
    const parsed = assetSnapshotSchema.safeParse(asset);
    if (!parsed.success) throw new MediaHostError(`Unreadable Mux asset: ${parsed.error.message}`, null, false);
    return parsed.data;
  }

  async generateSubtitles(assetId: string, audioTrackId: string): Promise<string[]> {
    const tracks = await call(() =>
      this.mux.video.assets.generateSubtitles(assetId, audioTrackId, {
        generated_subtitles: [{ language_code: "auto", name: "Transcript (generated)" }],
      }),
    );
    return tracks.flatMap((t) => (t.id ? [t.id] : []));
  }

  async deleteFailedCaptionTrack(assetId: string, trackId: string): Promise<void> {
    await call(() => this.mux.video.assets.deleteTrack(assetId, trackId));
  }

  async fetchTranscript(playbackId: string, trackId: string): Promise<string> {
    const token = await this.sign(playbackId, "video", 0);
    const url = `https://stream.mux.com/${playbackId}/text/${trackId}.txt?token=${token}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new MediaHostError(`Transcript fetch failed: ${errorMessage(err)}`, null, true, { cause: err });
    }
    if (!res.ok) {
      // 404 is retryable: a track reported ready can take a moment to be served.
      const retryable = res.status === 404 || res.status === 429 || res.status >= 500;
      throw new MediaHostError(`Transcript fetch answered ${res.status}`, res.status, retryable);
    }
    return (await res.text()).trim();
  }

  async playbackUrl(playbackId: string, kind: "hls" | "audio", durationS: number | null): Promise<string> {
    // A video token must outlive the playback, not just the page load: HLS
    // fetches segments with it for as long as the clip plays.
    const token = await this.sign(playbackId, "video", durationS ?? 0);
    return kind === "hls"
      ? `https://stream.mux.com/${playbackId}.m3u8?token=${token}`
      : `https://stream.mux.com/${playbackId}/audio.m4a?token=${token}`;
  }

  async posterUrl(playbackId: string, durationS: number | null): Promise<string> {
    // A couple of seconds in rather than frame 0, which is often black; the
    // middle of a clip shorter than that.
    const time = durationS && durationS > 0 ? Math.min(2, Math.floor(durationS / 2)) : 0;
    // Mux reads thumbnail options from the token's claims on a signed
    // playback id, and refuses them in the query string.
    const token = await this.sign(playbackId, "thumbnail", 0, { width: String(POSTER_WIDTH), time: String(time) });
    return `https://image.mux.com/${playbackId}/thumbnail.jpg?token=${token}`;
  }

  /**
   * A playback JWT (RS256, `sub` playback id, `aud` v or t, `kid`), reused
   * for TOKEN_REUSE_SECONDS. Each one is valid for at least
   * READ_URL_TTL_SECONDS + `extraSeconds` from the moment it is served.
   */
  private async sign(
    playbackId: string,
    type: "video" | "thumbnail",
    extraSeconds: number,
    params?: Record<string, string>,
  ): Promise<string> {
    const key = `${type}:${playbackId}:${extraSeconds}:${params ? JSON.stringify(params) : ""}`;
    const now = Date.now();
    const cached = this.tokens.get(key);
    if (cached && cached.reuseUntil > now) return cached.token;

    const lifetime = READ_URL_TTL_SECONDS + Math.max(0, Math.ceil(extraSeconds)) + TOKEN_REUSE_SECONDS;
    const token = await this.mux.jwt.signPlaybackId(playbackId, {
      type,
      expiration: `${lifetime}s`,
      ...(params ? { params } : {}),
    });

    this.tokens.delete(key);
    this.tokens.set(key, { token, reuseUntil: now + TOKEN_REUSE_SECONDS * 1000 });
    // Insertion order is age order: drop the oldest when full.
    while (this.tokens.size > TOKEN_CACHE_MAX) {
      const oldest = this.tokens.keys().next().value;
      if (oldest === undefined) break;
      this.tokens.delete(oldest);
    }
    return token;
  }
}

const webhookEnvelope = z.object({ id: z.string(), type: z.string(), data: z.unknown() });

/**
 * Verify a webhook's `mux-signature` (HMAC-SHA256 over `<t>.<body>`, at most
 * five minutes old) and parse it. Needs only the webhook secret, so it works
 * whether or not API credentials are set. Throws on any mismatch.
 */
export async function verifyMuxWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
): Promise<{ id: string; type: string; data?: unknown }> {
  const mux = new Mux({ tokenId: "unused", tokenSecret: "unused", webhookSecret: secret });
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") flat[name] = value;
    else if (Array.isArray(value) && value[0]) flat[name] = value[0];
  }
  await mux.webhooks.verifySignature(rawBody, flat, secret);
  const event = webhookEnvelope.safeParse(JSON.parse(rawBody));
  if (!event.success) throw new Error(`Webhook body unreadable: ${event.error.message}`);
  return event.data;
}

function toHostUpload(upload: {
  id: string;
  status: string;
  url?: string;
  asset_id?: string;
  error?: { message?: string; type?: string };
  new_asset_settings?: { passthrough?: string };
}): HostUpload {
  return {
    id: upload.id,
    status: upload.status,
    url: upload.url ?? null,
    assetId: upload.asset_id ?? null,
    passthrough: upload.new_asset_settings?.passthrough ?? null,
    error: upload.error ? (upload.error.message ?? upload.error.type ?? "upload errored") : null,
  };
}

/** Run an SDK call, turning its errors into MediaHostError with a retry opinion. */
async function call<T>(fn: () => PromiseLike<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIError) {
      const status = typeof err.status === "number" ? err.status : null;
      // No status: the request never got an answer (network, timeout).
      const retryable = status === null || status === 429 || status >= 500;
      throw new MediaHostError(`Mux ${status ?? "request"} failed: ${err.message}`, status, retryable, { cause: err });
    }
    throw new MediaHostError(`Mux request failed: ${errorMessage(err)}`, null, true, { cause: err });
  }
}
