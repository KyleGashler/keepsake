import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type HeadObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  UPLOAD_URL_TTL_SECONDS,
  assertDeletable,
  assertDerivativeWritable,
  assertFamilyPrefix,
  assertSafeKey,
  assertUploadable,
  attachmentDisposition,
  type ByteRange,
  type ObjectHead,
  type ReadUrlOptions,
  type StorageProvider,
  type UploadTarget,
} from "./StorageProvider.js";

export type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  // The host clients reach the bucket on, when it differs from `endpoint`.
  // Presigned URLs must be minted against it because the host is signed.
  publicEndpoint?: string;
  // Emulators serve `endpoint/bucket/key` rather than `bucket.endpoint/key`.
  forcePathStyle: boolean;
};

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
    // The SDK's default signs a CRC32 of the request body; a presigned PUT has
    // no body at signing time, so the real upload would fail that checksum.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  return new S3Client(options);
}

// The presigner leaves `content-type` unsigned by default, letting a client
// authorised for a PNG store anything; signing these pins type, size and create-only.
const SIGNED_UPLOAD_HEADERS = new Set(["content-type", "content-length", "if-none-match"]);

// A signed `If-None-Match: *` makes S3 refuse (412) any PUT to an existing key, so a
// replayed URL can't swap bytes under a recorded checksum. `writtenOnce` is the backstop.
export class S3StorageProvider implements StorageProvider {
  readonly bucket: string;
  private readonly client: S3Client;
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
        IfNoneMatch: "*",
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: SIGNED_UPLOAD_HEADERS },
    );
    return {
      url,
      method: "PUT",
      // Signed: omit either or change its value and S3 answers 403 SignatureDoesNotMatch.
      headers: { "Content-Type": input.mimeType, "If-None-Match": "*" },
      expiresAt: expires.toISOString(),
    };
  }

  // S3 returns its full-object CRC64NVME only with `ChecksumMode: ENABLED`.
  // Emulators may not keep one; finalize then hashes the bytes itself.
  async head(key: string): Promise<ObjectHead | null> {
    assertSafeKey(key);
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      const checksum = fullObjectChecksum(out);
      return { bytes: out.ContentLength ?? 0, ...(checksum ? { checksum } : {}) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async writtenOnce(key: string): Promise<boolean> {
    assertSafeKey(key);
    // Exact key only: `…/original.png` is also a prefix of `…/original.png.bak`.
    const out = await this.client.send(
      new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: key, MaxKeys: 10 }),
    );
    const versions = (out.Versions ?? []).filter((v) => v.Key === key).length;
    const deleteMarkers = (out.DeleteMarkers ?? []).filter((m) => m.Key === key).length;
    return versions + deleteMarkers <= 1;
  }

  async getReadUrl(key: string, ttlSeconds: number, options?: ReadUrlOptions): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Family media must never sit in a shared cache, nor outlive the URL that fetched it.
        ResponseCacheControl: `private, max-age=${ttlSeconds}`,
        ...(options?.downloadAs ? { ResponseContentDisposition: attachmentDisposition(options.downloadAs) } : {}),
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async stream(key: string, range?: ByteRange): Promise<Readable> {
    assertSafeKey(key);
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    // On Node the SDK's body is the HTTP response stream itself.
    if (!(out.Body instanceof Readable)) throw new Error(`Empty or non-stream body for ${key}`);
    return out.Body;
  }

  // No create-only condition: re-deriving replaces the rendering. The bucket
  // policy's create-only rule covers `original.*` keys only.
  async writeDerivative(key: string, body: Buffer, contentType: string): Promise<void> {
    assertDerivativeWritable(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    assertDeletable(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // On a versioned bucket a plain DeleteObject only hides the object behind a marker.
  // Needs s3:ListBucketVersions, s3:DeleteObject and s3:DeleteObjectVersion.
  async purgeForFamilyDelete(key: string): Promise<void> {
    assertSafeKey(key);
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (;;) {
      const out = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      // Exact key only: `…/original.png` is also a prefix of `…/original.png.bak`.
      const objects = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])]
        .filter((v) => v.Key === key)
        .map((v) => ({ Key: key, VersionId: v.VersionId }));
      if (objects.length) {
        const result = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }),
        );
        const failed = result.Errors ?? [];
        if (failed.length) {
          throw new Error(`S3 refused to delete ${failed.length} version(s) of ${key}: ${failed[0].Code ?? ""} ${failed[0].Message ?? ""}`);
        }
      }
      if (!out.IsTruncated) break;
      keyMarker = out.NextKeyMarker;
      versionIdMarker = out.NextVersionIdMarker;
    }
  }

  // A listing page holds at most 1,000 entries, the most one DeleteObjects takes.
  async purgeFamilyObjects(familyId: string): Promise<void> {
    assertFamilyPrefix(familyId);
    const prefix = `${familyId}/`;
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (;;) {
      const out = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      const objects = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])]
        .filter((v): v is typeof v & { Key: string } => typeof v.Key === "string" && v.Key.startsWith(prefix))
        .map((v) => ({ Key: v.Key, VersionId: v.VersionId }));
      if (objects.length) {
        const result = await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }),
        );
        const failed = result.Errors ?? [];
        if (failed.length) {
          throw new Error(
            `S3 refused to delete ${failed.length} version(s) under ${prefix}: ${failed[0].Code ?? ""} ${failed[0].Message ?? ""}`,
          );
        }
      }
      if (!out.IsTruncated) break;
      keyMarker = out.NextKeyMarker;
      versionIdMarker = out.NextVersionIdMarker;
    }
  }

  async healthCheck(): Promise<boolean> {
    // Fly's check times out at 5s; answer before it does.
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(3000),
    });
    return true;
  }

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

const CHECKSUM_FIELDS = [
  ["crc64nvme", "ChecksumCRC64NVME"],
  ["sha256", "ChecksumSHA256"],
  ["crc32c", "ChecksumCRC32C"],
  ["crc32", "ChecksumCRC32"],
  ["sha1", "ChecksumSHA1"],
] as const;

// Plain base64; a multipart checksum carries a `-<parts>` suffix.
const CHECKSUM_VALUE = /^[A-Za-z0-9+/]+={0,2}$/;

export function fullObjectChecksum(out: HeadObjectCommandOutput): string | undefined {
  // A COMPOSITE (multipart) checksum doesn't describe the bytes as a whole.
  if (out.ChecksumType === "COMPOSITE") return undefined;
  for (const [algorithm, field] of CHECKSUM_FIELDS) {
    const value = out[field];
    if (value && CHECKSUM_VALUE.test(value)) return `${algorithm}:${value}`;
  }
  return undefined;
}

function isNotFound(err: unknown) {
  if (!(err instanceof S3ServiceException)) return false;
  return err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata.httpStatusCode === 404;
}
