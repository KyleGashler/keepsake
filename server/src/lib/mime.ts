export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/webm": ".weba",
};

const BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
};

// Finalize refuses bytes whose sniffed type the declared one couldn't produce (a ".png" that's a script).
// Not equality: detectors name ISO-BMFF containers variously, and HEIC and HEIF are one format.
const ACCEPTS_SNIFFED: Record<string, string[]> = {
  "image/jpeg": ["image/jpeg"],
  "image/png": ["image/png", "image/apng"],
  "image/webp": ["image/webp"],
  "image/heic": ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  "video/mp4": ["video/mp4", "video/x-m4v", "video/quicktime"],
  "video/quicktime": ["video/quicktime", "video/mp4"],
  // MediaRecorder output. The sniff reads only the EBML DocType, which says "webm" with or without video.
  "video/webm": ["video/webm", "audio/webm"],
  "audio/m4a": ["audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4"],
  "audio/mp4": ["audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4"],
  "audio/mpeg": ["audio/mpeg"],
  "audio/wav": ["audio/wav", "audio/x-wav", "audio/vnd.wave"],
  "audio/webm": ["audio/webm", "video/webm"],
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "";
}

export function contentTypeForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return BY_EXTENSION[key.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

export function sniffedTypeMatches(declared: string, sniffed: string): boolean {
  return (ACCEPTS_SNIFFED[declared] ?? [declared]).includes(sniffed);
}

export function baseMimeType(declared: string): string {
  return declared.split(";")[0].trim().toLowerCase();
}

export function mediaTypeFor(mimeType: string): "PHOTO" | "VIDEO" | "AUDIO" {
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return "PHOTO";
}
