import { RecordingPresets, type RecordingOptions } from "expo-audio";

/**
 * Voice, not music: one channel at 96 kbps keeps a conversation clear while a
 * long one stays well under the upload ceiling (~0.7 MB a minute). Metering is
 * on so the recorder can draw a live level.
 *
 * What comes out: iOS and Android write AAC in an MPEG-4 container (`.m4a`).
 * On the web the preset asks MediaRecorder for `audio/webm` — Chrome and
 * recent Safari give WebM/Opus; a browser that can't falls back to its own
 * default (older Safari: `audio/mp4`). The real type is read off the Blob.
 */
export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  web: { mimeType: "audio/webm", bitsPerSecond: 96000 },
};

/**
 * Settle on one declared type and a matching extension before uploading, so
 * `init`'s allowlist, the stored key and the server's byte sniff all agree.
 * Codec parameters (`audio/webm;codecs=opus`) are dropped; the server would
 * strip them too, but the filename extension is chosen here.
 */
export function normalizeAudioType(rawMime: string | null | undefined, uri: string) {
  const base = (rawMime ?? "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm" || base === "video/webm") return { mime: "audio/webm", ext: ".weba" };
  if (["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "video/mp4"].includes(base)) {
    return { mime: "audio/mp4", ext: ".m4a" };
  }
  if (base === "audio/mpeg") return { mime: "audio/mpeg", ext: ".mp3" };
  if (base === "audio/wav" || base === "audio/x-wav") return { mime: "audio/wav", ext: ".wav" };
  // Native recordings carry no type at all — the file extension is the truth.
  const path = uri.split("?")[0].toLowerCase();
  if (path.endsWith(".webm") || path.endsWith(".weba")) return { mime: "audio/webm", ext: ".weba" };
  if (path.endsWith(".wav")) return { mime: "audio/wav", ext: ".wav" };
  return { mime: "audio/mp4", ext: ".m4a" };
}

/** dBFS (−160 silence … 0 clipping) → 0..1, tuned so ordinary speech sits mid-meter. */
export function levelFromMetering(db: number | undefined) {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 55) / 50));
}
