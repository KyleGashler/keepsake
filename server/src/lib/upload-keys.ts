import { contentTypeForKey, mediaTypeFor } from "./mime.js";
import { READ_URL_TTL_SECONDS, StorageKeyError, assertSafeKey, storage } from "../storage/index.js";
import { isOriginalKey } from "../storage/StorageProvider.js";

/**
 * A storage key carries its owning family in its prefix
 * (`<familyId>/<uploadId>/original.<ext>`), which is how a route proves a key
 * is the caller's before it ever reaches storage.
 */
export function keyBelongsTo(key: string, familyId: string) {
  return key.startsWith(`${familyId}/`);
}

export type ImageKeyProblem = "malformed" | "foreign" | "not_an_image" | "missing";

/**
 * Check a key the client hands back from `POST /api/media/finalize` before a
 * row points at it as a picture (a child's profile photo, a pillar cover).
 *
 * Same rules as attaching media to a memory — the family prefix — plus: it
 * names an original, its type is an image, and the object is actually there.
 * Returns null when the key is fine, else what's wrong with it.
 */
export async function imageKeyProblem(key: string, familyId: string): Promise<ImageKeyProblem | null> {
  try {
    assertSafeKey(key);
  } catch (err) {
    if (err instanceof StorageKeyError) return "malformed";
    throw err;
  }
  if (!keyBelongsTo(key, familyId)) return "foreign";
  if (!isOriginalKey(key) || mediaTypeFor(contentTypeForKey(key)) !== "PHOTO") return "not_an_image";
  if (contentTypeForKey(key) === "application/octet-stream") return "not_an_image";
  if (!(await storage().head(key))) return "missing";
  return null;
}

/** The HTTP answer for each problem: someone else's key reads as absent. */
export function imageKeyError(problem: ImageKeyProblem) {
  switch (problem) {
    case "malformed":
      return { status: 400, body: { error: "Malformed storage key", code: "malformed_key" } };
    case "not_an_image":
      return { status: 415, body: { error: "That upload isn't an image", code: "not_an_image" } };
    default:
      // "foreign" and "missing" alike: another family's key reads as absent.
      return { status: 404, body: { error: "Upload not found", code: "upload_not_found" } };
  }
}

/** A stored picture's read URL, signed fresh per response. */
export function signedImageUrl(key: string) {
  return storage().getReadUrl(key, READ_URL_TTL_SECONDS);
}
