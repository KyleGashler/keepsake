/**
 * How the in-app video recorder stays under the upload ceiling.
 *
 * The only stop is the byte budget: a recording ends just before it would be
 * too big to upload, rather than letting someone film and then hear the clip
 * can't be kept (docs/PLAN.md, "Decision: video, for now"). The recording
 * quality is set explicitly, so seconds → bytes is predictable and the timer
 * can say how long is left:
 *
 * - Native: 720p H.264 at a 5 Mbps target, plus the camera's AAC audio. On
 *   iOS the bitrate only applies when a codec is named, so `avc1` is always
 *   passed — which also means the clip is H.264, not HEVC, and plays in every
 *   browser. ~0.65 MB a second: about 43 minutes under a 2 GB ceiling.
 * - Web: MediaRecorder at 2.5 Mbps video + 128 kbps audio on a 720p stream.
 *   ~0.33 MB a second: about 86 minutes. The clip is held in browser memory
 *   until it's uploaded.
 *
 * Bitrates are targets, not ceilings, so the recorders also stop on bytes:
 * native via `maxFileSize`, the web by counting chunks as they arrive.
 */

export const NATIVE_VIDEO = {
  quality: "720p" as const,
  videoBitrate: 5_000_000,
  /** What the camera's AAC track is assumed to add. */
  audioAllowance: 192_000,
};

export const WEB_VIDEO = {
  width: 1280,
  height: 720,
  videoBitsPerSecond: 2_500_000,
  audioBitsPerSecond: 128_000,
};

/** Used only if `/api/media/limits` can't be read; init still enforces the real one. */
export const FALLBACK_MAX_UPLOAD_BYTES = 2_000_000_000;

/**
 * Seconds and bytes a recording may run to, both from the upload ceiling.
 * Duration is planned against 85% of the ceiling so a scene that encodes
 * heavier than the target still fits; the byte stop sits at 95%, the last
 * line before init would refuse it. Whichever comes first ends the take.
 */
export function recordingBudget(maxUploadBytes: number, bitsPerSecond: number) {
  const plannedSeconds = Math.floor((maxUploadBytes * 0.85 * 8) / bitsPerSecond);
  return {
    maxDurationS: Math.max(10, plannedSeconds),
    maxFileSize: Math.floor(maxUploadBytes * 0.95),
  };
}

/**
 * MediaRecorder types in order of preference: MP4 first (H.264/AAC plays
 * everywhere, including Safari and on phones), then WebM. Chrome 126+ and
 * Safari record MP4; Firefox records WebM. Null if the browser can't record
 * video at all.
 */
export function pickWebVideoMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // Some browsers throw on a codec string they don't parse; try the next.
    }
  }
  return null;
}

/**
 * One declared type and a matching extension, so init's allowlist, the stored
 * key and the server's byte sniff agree. Codec parameters are dropped.
 *
 * Native recordings carry no type — the extension is the truth: expo-camera
 * writes `.mov` on iOS (AVCaptureMovieFileOutput) and `.mp4` on Android
 * (CameraX). On the web the Blob says what MediaRecorder actually wrote.
 */
export function normalizeVideoType(rawMime: string | null | undefined, uri: string) {
  const base = (rawMime ?? "").split(";")[0].trim().toLowerCase();
  if (base === "video/mp4") return { mime: "video/mp4", ext: ".mp4" };
  if (base === "video/webm") return { mime: "video/webm", ext: ".webm" };
  if (base === "video/quicktime") return { mime: "video/quicktime", ext: ".mov" };
  const path = uri.split("?")[0].toLowerCase();
  if (path.endsWith(".mov")) return { mime: "video/quicktime", ext: ".mov" };
  if (path.endsWith(".webm")) return { mime: "video/webm", ext: ".webm" };
  return { mime: "video/mp4", ext: ".mp4" };
}
