// iOS applies the bitrate only when a codec is named, so native recording passes `avc1`.
// Bitrates are targets, not ceilings, so recorders also stop on bytes.
export const NATIVE_VIDEO = {
  quality: "720p" as const,
  videoBitrate: 5_000_000,
  audioAllowance: 192_000,
};

export const WEB_VIDEO = {
  width: 1280,
  height: 720,
  videoBitsPerSecond: 2_500_000,
  audioBitsPerSecond: 128_000,
};

export const FALLBACK_MAX_UPLOAD_BYTES = 2_000_000_000;

// Encoders overshoot their target bitrate, hence the 85% duration plan and 95% byte stop.
export function recordingBudget(maxUploadBytes: number, bitsPerSecond: number) {
  const plannedSeconds = Math.floor((maxUploadBytes * 0.85 * 8) / bitsPerSecond);
  return {
    maxDurationS: Math.max(10, plannedSeconds),
    maxFileSize: Math.floor(maxUploadBytes * 0.95),
  };
}

// MP4 plays everywhere, including Safari; Firefox records only WebM.
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

// Native recordings carry no type: expo-camera writes `.mov` on iOS and `.mp4` on Android.
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
