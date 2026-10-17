/**
 * What a family is allowed to keep, and how a declared type maps to a file
 * extension and back.
 *
 * Two separate jobs live here. The allowlist gates what `POST /api/media/init`
 * will hand out a target for. The alias table gates finalize: the bytes that
 * actually arrived are sniffed, and the sniffed type has to be one the declared
 * type could plausibly produce — that's what stops a script uploading a
 * `.png` that is really a shell.
 */

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

/**
 * The type a stored object is served as. Derived from the key's extension
 * rather than a database lookup, so `/media/o/<token>` stays a pure streaming
 * route with nothing to join against.
 */
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

/**
 * Sniffed types that count as a match for a declared one. Containers are the
 * reason this isn't equality: an `.m4a` is an ISO-BMFF box that detectors
 * variously call `audio/mp4`, `audio/x-m4a` or `video/mp4`, and HEIC and HEIF
 * are the same format under two names.
 */
const ACCEPTS_SNIFFED: Record<string, string[]> = {
  "image/jpeg": ["image/jpeg"],
  "image/png": ["image/png", "image/apng"],
  "image/webp": ["image/webp"],
  "image/heic": ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"],
  "video/mp4": ["video/mp4", "video/x-m4v", "video/quicktime"],
  "video/quicktime": ["video/quicktime", "video/mp4"],
  // What a browser's MediaRecorder writes. The sniff reads only the EBML
  // DocType, which says "webm" with or without a video track — file-type
  // calls that video/webm today, but audio/webm is the same container.
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
  if (dot < 0) return "application/octet-stream";
  return BY_EXTENSION[key.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

export function sniffedTypeMatches(declared: string, sniffed: string): boolean {
  return (ACCEPTS_SNIFFED[declared] ?? [declared]).includes(sniffed);
}

/**
 * The bare type/subtype, lowercased: `audio/webm;codecs=opus` → `audio/webm`.
 * Everything in this file is keyed on bare types.
 */
export function baseMimeType(declared: string): string {
  return declared.split(";")[0].trim().toLowerCase();
}

export function mediaTypeFor(mimeType: string): "PHOTO" | "VIDEO" | "AUDIO" {
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  return "PHOTO";
}
