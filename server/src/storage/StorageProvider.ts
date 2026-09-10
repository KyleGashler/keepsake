/**
 * Where original media lives.
 *
 * The rest of the server never touches a filesystem path or a bucket name: it
 * asks for an upload target, hands the client the answer, and later asks for a
 * read URL. Today that's the local disk (`LocalDiskProvider`); tomorrow it's S3
 * or R2 (task B2) and no route changes.
 *
 * The contract is deliberately shaped like presigned object storage rather than
 * like a filesystem — the client uploads *directly* to the target, so the API
 * process never proxies bytes once a real bucket is behind this.
 */

/** Everything a client needs to push the bytes itself. */
export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  /** ISO-8601. After this the target is refused and the client must re-init. */
  expiresAt: string;
}

export interface StorageProvider {
  /**
   * Authorise one upload of exactly `bytes` bytes of `mimeType` to `key`.
   * The size and type are part of what's authorised, so a client can't be
   * handed a target for a 2 MB JPEG and use it to store a 2 GB anything.
   */
  createUploadTarget(input: { key: string; mimeType: string; bytes: number }): Promise<UploadTarget>;

  /** Object metadata, or null when nothing is stored at `key`. */
  head(key: string): Promise<{ bytes: number } | null>;

  /**
   * A URL a client can GET for `ttlSeconds`. May be a relative path (the local
   * provider returns `/media/o/<token>`); callers resolve it against the API
   * origin the way they already do for `/media/gen/...`.
   */
  getReadUrl(key: string, ttlSeconds: number): Promise<string>;

  /** Read the object back — used for sniffing, hashing and future derivatives. */
  stream(key: string): Promise<NodeJS.ReadableStream>;

  /**
   * Derivatives only. Original media is sacred: nothing in this codebase may
   * call this with an original's key, and implementations refuse if asked.
   */
  delete(key: string): Promise<void>;
}

/** Hard ceiling on a single original, enforced at init and again at upload. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** How long a DTO's media URL stays good. Matches the Cache-Control we send. */
export const READ_URL_TTL_SECONDS = 3600;

/**
 * Keys are `<familyId>/<mediaId>/original.<ext>` for originals and
 * `<familyId>/<mediaId>/<kind>.<ext>` for the derivatives A6 will add. The
 * family prefix is what lets a route prove a key belongs to the caller before
 * it ever reaches storage.
 */
export function originalKey(familyId: string, mediaId: string, ext: string) {
  return `${familyId}/${mediaId}/original${ext}`;
}

/** True when `key` names an original — the one thing `delete()` must refuse. */
export function isOriginalKey(key: string) {
  return /(^|\/)original(\.[^./]+)?$/.test(key);
}

const KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Reject anything that could escape the object root or confuse a bucket:
 * traversal, absolute paths, empty segments, leading dots.
 */
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

export class StorageKeyError extends Error {}
