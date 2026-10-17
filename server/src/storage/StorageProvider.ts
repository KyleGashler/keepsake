/**
 * Where original media lives.
 *
 * The rest of the server never touches a filesystem path or a bucket name: it
 * asks for an upload target, hands the client the answer, and later asks for a
 * read URL. `LocalDiskProvider` keeps objects on a volume; `S3StorageProvider`
 * (task B2) keeps them in a bucket. `STORAGE_PROVIDER` picks one and no route
 * cares which.
 *
 * The contract is deliberately shaped like presigned object storage rather than
 * like a filesystem — the client uploads *directly* to the target, so the API
 * process never proxies bytes once a real bucket is behind this.
 */

/** Everything a client needs to push the bytes itself. */
export interface UploadTarget {
  url: string;
  method: "PUT";
  /**
   * Send these exactly, and nothing that contradicts them. `Content-Length` is
   * also authorised (it must equal the size given to init) but isn't listed:
   * every HTTP client derives it from the body, and browsers refuse to let
   * script set it.
   */
  headers: Record<string, string>;
  /** ISO-8601. After this the target is refused and the client must re-init. */
  expiresAt: string;
}

/** Inclusive byte offsets, as in an HTTP `Range: bytes=start-end` header. */
export type ByteRange = { start: number; end: number };

export type ObjectHead = {
  bytes: number;
  /** `<algorithm>:<base64>` over the full object; see `head()`. */
  checksum?: string;
};

export interface StorageProvider {
  /**
   * Authorise one upload of exactly `bytes` bytes of `mimeType` to `key`.
   * The size and type are part of what's authorised, so a client can't be
   * handed a target for a 2 MB JPEG and use it to store a 2 GB anything.
   */
  createUploadTarget(input: { key: string; mimeType: string; bytes: number }): Promise<UploadTarget>;

  /**
   * Object metadata, or null when nothing is stored at `key`. `checksum` is the
   * store's own digest of the whole object, as `<algorithm>:<base64>` (e.g.
   * `crc64nvme:…` from S3), when the store keeps one. Finalize records it
   * instead of reading the object back to hash it; a provider that can't vouch
   * for every byte (local disk, most emulators) leaves it out.
   */
  head(key: string): Promise<ObjectHead | null>;

  /**
   * False when `key` has held more than one object — i.e. something was
   * written over the upload after init authorised it. Finalize refuses such a
   * key: the digest it records has to describe the only bytes there have ever
   * been. Providers that make an overwrite impossible at write time may still
   * report what they can observe.
   */
  writtenOnce(key: string): Promise<boolean>;

  /**
   * A URL a client can GET for `ttlSeconds`. May be a relative path (the local
   * provider returns `/media/o/<token>`); callers resolve it against the API
   * origin the way they already do for `/media/gen/...`.
   */
  getReadUrl(key: string, ttlSeconds: number): Promise<string>;

  /**
   * Read the object back — used for sniffing, hashing and future derivatives.
   * With `range`, only bytes `start..end` (inclusive, like HTTP `Range`) are
   * read, so a sniff of a 2 GB video costs a few KB rather than an abandoned
   * download. A range past the end of the object returns what there is.
   */
  stream(key: string, range?: ByteRange): Promise<NodeJS.ReadableStream>;

  /**
   * Derivatives only. Original media is sacred: nothing in this codebase may
   * call this with an original's key, and implementations refuse if asked.
   */
  delete(key: string): Promise<void>;

  /**
   * Whether the backing store is reachable — `/api/health` asks this. May
   * throw instead of returning false; the caller counts a throw as unhealthy
   * and logs it, which keeps the reason.
   */
  healthCheck(): Promise<boolean>;
}

/**
 * Hard ceiling on a single original, enforced at init and again at upload.
 * 2 GB (decimal) is Deepgram's per-file limit. It must stay at or below
 * 2,147,483,647: `Media.bytes` is a Postgres `int4`, and a larger upload would
 * fail at memory creation, after the family has waited for it to finish.
 * Going past it needs `Media.bytes` as a BigInt and multipart uploads (see
 * docs/PLAN.md, "Later: long media, properly").
 */
export const MAX_UPLOAD_BYTES = 2_000_000_000;

/**
 * How long a client has to actually push the bytes after init. A single PUT
 * of 2 GB on a slow uplink takes a while; S3 checks the expiry when the
 * request starts, so this bounds when an upload may begin, not how long it
 * may run.
 */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

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

/** The size and key checks every provider makes before authorising an upload. */
export function assertUploadable(input: { key: string; bytes: number }) {
  assertSafeKey(input.key);
  if (!Number.isInteger(input.bytes) || input.bytes <= 0 || input.bytes > MAX_UPLOAD_BYTES) {
    throw new StorageKeyError("Upload size out of range");
  }
}

/**
 * The guard behind every `delete()`: derivatives may go, originals may not.
 * Shared so no provider can forget it.
 */
export function assertDeletable(key: string) {
  assertSafeKey(key);
  // Belt and braces: the interface says derivatives only, and this makes a
  // future caller's mistake an exception rather than a lost photograph.
  if (isOriginalKey(key)) throw new StorageKeyError("Refusing to delete an original");
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
