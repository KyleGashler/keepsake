import { LocalDiskProvider } from "./LocalDiskProvider.js";
import { S3StorageProvider, s3ConfigFromEnv } from "./S3StorageProvider.js";
import type { StorageProvider } from "./StorageProvider.js";

export { MAX_UPLOAD_BYTES, READ_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS, PHOTO_DERIVATIVE_KINDS, originalKey, derivativeKey, assertSafeKey, attachmentDisposition, StorageKeyError } from "./StorageProvider.js";
export type { ByteRange, ObjectHead, PhotoDerivativeKind, ReadUrlOptions, StorageProvider, UploadTarget } from "./StorageProvider.js";

// Throws on an unknown value rather than falling back: writing a family's photos to the wrong place can't be undone.
export function createStorageProvider(): StorageProvider {
  const name = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  switch (name) {
    case "local":
      return new LocalDiskProvider();
    case "s3":
      return new S3StorageProvider(s3ConfigFromEnv());
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${name}" (expected: local, s3)`);
  }
}

let instance: StorageProvider | null = null;

// Lazy so an import can't blow up before logging exists.
export function storage(): StorageProvider {
  if (!instance) instance = createStorageProvider();
  return instance;
}

export function localProvider(): LocalDiskProvider | null {
  const provider = storage();
  return provider instanceof LocalDiskProvider ? provider : null;
}
