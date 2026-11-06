import type { Readable } from "node:stream";

export interface UploadTarget {
  url: string;
  method: "PUT";
  // Content-Length is also signed but not listed: browsers refuse to let script set it.
  headers: Record<string, string>;
  expiresAt: string;
}

/** Inclusive byte offsets, as in an HTTP `Range: bytes=start-end` header. */
export type ByteRange = { start: number; end: number };

export type ReadUrlOptions = {
  downloadAs?: string;
};

/** ASCII fallback filename plus the exact name in RFC 5987 form for browsers that read it. */
export function attachmentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const exact = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

export type ObjectHead = {
  bytes: number;
  /** The store's own whole-object digest as `<algorithm>:<base64>` (e.g. S3 `crc64nvme:…`); absent when it can't vouch for every byte. */
  checksum?: string;
};

export interface StorageProvider {
  /** Size and type are signed, so a target can't be reused to store something bigger or different. */
  createUploadTarget: (input: { key: string; mimeType: string; bytes: number }) => Promise<UploadTarget>;
  head: (key: string) => Promise<ObjectHead | null>;
  writtenOnce: (key: string) => Promise<boolean>;
  /** May be a relative path (`/media/o/<token>`); resolve it against the API origin. */
  getReadUrl: (key: string, ttlSeconds: number, options?: ReadUrlOptions) => Promise<string>;
  stream: (key: string, range?: ByteRange) => Promise<Readable>;
  writeDerivative: (key: string, body: Buffer, contentType: string) => Promise<void>;
  /** Derivatives only: originals are refused. `purgeForFamilyDelete` is the one way an original goes. */
  delete: (key: string) => Promise<void>;
  /** Removes every version on a versioned bucket. Only the `media.purge` job calls this. */
  purgeForFamilyDelete: (key: string) => Promise<void>;
  /** Every version and delete marker under `<familyId>/`. Only `media.purge`, after the family is deleted. */
  purgeFamilyObjects: (familyId: string) => Promise<void>;
  healthCheck: () => Promise<boolean>;
}

// Must stay at or below 2,147,483,647: `Media.bytes` is a Postgres `int4`.
export const MAX_UPLOAD_BYTES = 2_000_000_000;

// S3 checks the expiry when the request starts, so this bounds when an upload may begin, not how long it runs.
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

// Matches the Cache-Control we send.
export const READ_URL_TTL_SECONDS = 3600;

export function originalKey(familyId: string, mediaId: string, ext: string) {
  return `${familyId}/${mediaId}/original${ext}`;
}

export type PhotoDerivativeKind = "THUMB" | "DISPLAY";
export const PHOTO_DERIVATIVE_KINDS: readonly PhotoDerivativeKind[] = ["THUMB", "DISPLAY"];

// Named from the original's key alone so a purge can find it without a `Derivative` row.
export function derivativeKey(original: string, kind: PhotoDerivativeKind) {
  if (!isOriginalKey(original)) throw new StorageKeyError("Derivatives are named from an original's key");
  return `${original.slice(0, original.lastIndexOf("/"))}/${kind.toLowerCase()}.jpg`;
}

export function assertDerivativeWritable(key: string) {
  assertSafeKey(key);
  if (isOriginalKey(key)) throw new StorageKeyError("Refusing to write over an original");
}

export function assertUploadable(input: { key: string; bytes: number }) {
  assertSafeKey(input.key);
  if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > MAX_UPLOAD_BYTES) {
    throw new StorageKeyError("Upload size out of range");
  }
}

export function assertDeletable(key: string) {
  assertSafeKey(key);
  if (isOriginalKey(key)) throw new StorageKeyError("Refusing to delete an original");
}

export function isOriginalKey(key: string) {
  return /(^|\/)original(\.[^./]+)?$/.test(key);
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeKey(key: string): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new StorageKeyError("Storage key missing or too long");
  }
  const segments = key.split("/");
  if (segments.length < 2 || segments.length > 6) throw new StorageKeyError("Malformed storage key");
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment)) throw new StorageKeyError(`Illegal storage key segment: ${segment}`);
  }
}

// Strict so a prefix purge of `<familyId>/` can never widen into other families' keys.
export function assertFamilyPrefix(familyId: string): asserts familyId is string {
  if (typeof familyId !== "string" || familyId.length < 8 || familyId.length > 64 || !KEY_SEGMENT.test(familyId)) {
    throw new StorageKeyError("Malformed family id for a prefix purge");
  }
}

export class StorageKeyError extends Error {}
