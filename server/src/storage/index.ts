import { LocalDiskProvider } from "./LocalDiskProvider.js";
import type { StorageProvider } from "./StorageProvider.js";

export { MAX_UPLOAD_BYTES, READ_URL_TTL_SECONDS, originalKey, assertSafeKey, StorageKeyError } from "./StorageProvider.js";
export type { StorageProvider, UploadTarget } from "./StorageProvider.js";

/**
 * `STORAGE_PROVIDER` picks the implementation. Only `local` exists today; B2
 * adds `s3` here and nothing else in the server changes. An unrecognised value
 * throws rather than quietly falling back, because silently writing a family's
 * photographs to the wrong place is not a recoverable mistake.
 */
export function createStorageProvider(): StorageProvider {
  const name = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  switch (name) {
    case "local":
      return new LocalDiskProvider();
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${name}" (expected: local)`);
  }
}

let instance: StorageProvider | null = null;

/** The process-wide provider. Lazy so an import can't blow up before logging exists. */
export function storage(): StorageProvider {
  if (!instance) instance = createStorageProvider();
  return instance;
}

/**
 * The local provider's own routes need more than the interface (token
 * verification, streamed writes). Returns null when something else is
 * configured, so those routes can 404 instead of pretending.
 */
export function localProvider(): LocalDiskProvider | null {
  const provider = storage();
  return provider instanceof LocalDiskProvider ? provider : null;
}
