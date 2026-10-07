import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  UPLOAD_URL_TTL_SECONDS,
  assertDeletable,
  assertSafeKey,
  assertUploadable,
  type StorageProvider,
  type UploadTarget,
} from "./StorageProvider.js";

export type S3Config = {
  bucket: string;
  region: string;
  /** Where this process reaches the bucket. Unset means AWS itself. */
  endpoint?: string;
  /**
   * Where a *client* reaches the bucket, when that differs from `endpoint` —
   * e.g. the API talks to `http://s3:9000` inside compose while the browser
   * needs `http://localhost:9300`. Presigned URLs are minted against this,
   * because the host is part of what's signed.
   */
  publicEndpoint?: string;
  /** Emulators serve `endpoint/bucket/key` rather than `bucket.endpoint/key`. */
  forcePathStyle: boolean;
};

/**
 * Read once at boot. A missing bucket is a configuration error, not something
 * to discover on the first upload. Credentials are left to the SDK's default
 * chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` on Fly).
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) throw new Error("STORAGE_PROVIDER=s3 needs S3_BUCKET");
  const region = (env.S3_REGION ?? env.AWS_REGION)?.trim();
  if (!region) throw new Error("STORAGE_PROVIDER=s3 needs S3_REGION");
  return {
    bucket,
    region,
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT?.trim() || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "1" || env.S3_FORCE_PATH_STYLE === "true",
  };
}

function clientFor(config: S3Config, endpoint: string | undefined) {
  const options: S3ClientConfig = {
    region: config.region,
    endpoint,
    forcePathStyle: config.forcePathStyle,
    // The SDK's default ("when supported") adds a CRC32 of the request body to
    // every PutObject. A presigned PUT has no body when it's signed, so that
    // checksum would describe zero bytes and the real upload would fail it.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  return new S3Client(options);
}

/**
 * Headers bound into the presigned PUT's signature. The presigner leaves
 * `content-type` out by default, which would let a client authorised for a
 * PNG store anything; naming it here makes a different type a signature
 * mismatch. `content-length` pins the size the same way, and `if-none-match`
 * is what makes the upload create-only (see `createUploadTarget`).
 */
const SIGNED_UPLOAD_HEADERS = new Set(["content-type", "content-length", "if-none-match"]);

/**
 * Originals in an S3 bucket (or anything that speaks S3 well enough to
 * validate SigV4 — the compose emulator is RustFS).
 *
 * The client talks to the bucket directly through presigned URLs, so this
 * process never proxies upload or playback bytes. It reads an object back only
 * at finalize, streamed, to sniff and hash it.
 *
 * ## Why a re-PUT can't swap the bytes under a recorded sha256
 *
 * The local provider refuses a write to an existing key (409). Here the client
 * PUTs straight to the bucket, so the same rule is enforced two ways:
 *
 * 1. **At write time — the real guard.** The presigned PUT carries
 *    `If-None-Match: *` inside its signature. S3 (conditional writes, 2024)
 *    then refuses any PUT to a key that already holds an object with
 *    `412 Precondition Failed`, and the client can't drop the header because
 *    the signature covers it. Replaying the URL after finalize — or racing a
 *    second PUT in before it — fails at the bucket. `docs/aws/bucket-policy.json`
 *    additionally denies any original PUT without the condition, so even a
 *    URL signed by some other code path can't overwrite.
 *
 * 2. **At finalize — the backstop.** `writtenOnce()` lists the key's versions.
 *    On a versioned bucket (production's is), more than one version or a
 *    delete marker means something was written over the upload, and finalize
 *    refuses it. On an unversioned bucket the check is vacuous and (1) stands
 *    alone.
 *
 * What this does *not* do is pin reads to a `VersionId`: recording one needs a
 * `Media.storageVersion` column, and no existing column means that. With (1)
 * in force a key never gets a second version, so the latest is the original.
 */
export class S3StorageProvider implements StorageProvider {
  readonly bucket: string;
  private readonly client: S3Client;
  /** Signs URLs for the client's view of the endpoint; never sends a request. */
  private readonly presigner: S3Client;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = clientFor(config, config.endpoint);
    this.presigner = config.publicEndpoint ? clientFor(config, config.publicEndpoint) : this.client;
  }

  async createUploadTarget(input: { key: string; mimeType: string; bytes: number }): Promise<UploadTarget> {
    assertUploadable(input);
    const expires = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const url = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.mimeType,
        ContentLength: input.bytes,
        // Create-only. See the class comment.
        IfNoneMatch: "*",
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: SIGNED_UPLOAD_HEADERS },
    );
    return {
      url,
      method: "PUT",
      // Both are signed: omit either, or send a different value, and S3 answers
      // 403 SignatureDoesNotMatch. Content-Length is signed too; the client's
      // HTTP stack sets it from the body.
      headers: { "Content-Type": input.mimeType, "If-None-Match": "*" },
      expiresAt: expires.toISOString(),
    };
  }

  async head(key: string): Promise<{ bytes: number } | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { bytes: out.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writtenOnce(key: string): Promise<boolean> {
    assertSafeKey(key);
    // Prefix listing, then exact match: `…/original.png` is also a prefix of a
    // hypothetical `…/original.png.bak`, which is a different object.
    const out = await this.client.send(
      new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: key, MaxKeys: 10 }),
    );
    const versions = (out.Versions ?? []).filter((v) => v.Key === key).length;
    const deleteMarkers = (out.DeleteMarkers ?? []).filter((m) => m.Key === key).length;
    return versions + deleteMarkers <= 1;
  }

  async getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Same policy as the local `/media/o` route: family media must never sit
        // in a shared cache, nor outlive the URL that fetched it.
        ResponseCacheControl: `private, max-age=${ttlSeconds}`,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * The object body as a Node stream, straight off the socket. Finalize reads
   * a few KB and destroys it (which aborts the request), then reads it again
   * end to end through a hash — never all in memory.
   */
  async stream(key: string): Promise<NodeJS.ReadableStream> {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error(`Empty body for ${key}`);
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertDeletable(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async healthCheck(): Promise<boolean> {
    // Fly's check times out at 5s; answer before it does.
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(3000),
    });
    return true;
  }

  // ---- Not part of StorageProvider: the local→S3 copy script uses this ------

  /**
   * Store an existing original, create-only. Returns "exists" rather than
   * overwriting when the key is already taken, so a re-run is harmless.
   */
  async putOriginalIfAbsent(input: {
    key: string;
    body: Readable;
    bytes: number;
    contentType: string;
  }): Promise<"created" | "exists"> {
    assertSafeKey(input.key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentLength: input.bytes,
          ContentType: input.contentType,
          IfNoneMatch: "*",
        }),
      );
      return "created";
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 412) return "exists";
      throw err;
    }
  }
}

function isNotFound(err: unknown) {
  if (!(err instanceof S3ServiceException)) return false;
  return err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata.httpStatusCode === 404;
}
