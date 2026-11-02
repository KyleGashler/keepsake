/**
 * A storage key carries its owning family in its prefix
 * (`<familyId>/<uploadId>/original.<ext>`), which is how a route proves a key
 * is the caller's before it ever reaches storage.
 */
export function keyBelongsTo(key: string, familyId: string) {
  return key.startsWith(`${familyId}/`);
}

/** Why `setPicture` (lib/pictures.ts) refused a key. */
export type ImageKeyProblem = "malformed" | "foreign" | "not_an_image" | "missing";

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
