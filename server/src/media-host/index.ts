import { logger } from "../lib/logger.js";
import { MediaHostUnavailableError, type MediaHost } from "./MediaHost.js";
import { MuxMediaHost, type MuxConfig } from "./MuxMediaHost.js";

export { MediaHostError, MediaHostUnavailableError } from "./MediaHost.js";
export type { AssetSnapshot, HostUpload, MediaHost } from "./MediaHost.js";
export { verifyMuxWebhook } from "./MuxMediaHost.js";

const REQUIRED = ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET", "MUX_SIGNING_KEY_ID", "MUX_SIGNING_KEY_PRIVATE"] as const;

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** Which of the variables a working host needs are unset. Empty means configured. */
export function missingMuxEnv(): string[] {
  return REQUIRED.filter((name) => !env(name));
}

function muxConfigFromEnv(): MuxConfig | null {
  const tokenId = env("MUX_TOKEN_ID");
  const tokenSecret = env("MUX_TOKEN_SECRET");
  const signingKeyId = env("MUX_SIGNING_KEY_ID");
  const signingKeyPrivate = env("MUX_SIGNING_KEY_PRIVATE");
  if (!tokenId || !tokenSecret || !signingKeyId || !signingKeyPrivate) return null;
  return { tokenId, tokenSecret, signingKeyId, signingKeyPrivate };
}

/** `MUX_WEBHOOK_SECRET`, or null when webhooks aren't set up (dev without a tunnel). */
export function muxWebhookSecret(): string | null {
  return env("MUX_WEBHOOK_SECRET");
}

let instance: MediaHost | null | undefined;

/**
 * The process-wide host, or null when Mux isn't configured. Null is a normal
 * state, not an error: the server boots, photos work, AV uploads answer 503,
 * and existing clips serialize without URLs. Callers that can't go on without
 * a host use `requireMediaHost()`.
 */
export function mediaHost(): MediaHost | null {
  if (instance === undefined) {
    const config = muxConfigFromEnv();
    instance = config ? new MuxMediaHost(config) : null;
    if (!instance) {
      logger.warn({ missing: missingMuxEnv() }, "Mux is not configured; video and audio uploads are disabled");
    }
  }
  return instance;
}

export function requireMediaHost(): MediaHost {
  const host = mediaHost();
  if (!host) throw new MediaHostUnavailableError();
  return host;
}
