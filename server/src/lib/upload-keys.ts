export function keyBelongsTo(key: string, familyId: string) {
  return key.startsWith(`${familyId}/`);
}

export type ImageKeyProblem = "malformed" | "foreign" | "not_an_image" | "missing";

export function imageKeyError(problem: ImageKeyProblem) {
  switch (problem) {
    case "malformed":
      return { status: 400, body: { error: "Malformed storage key", code: "malformed_key" } };
    case "not_an_image":
      return { status: 415, body: { error: "That upload isn't an image", code: "not_an_image" } };
    default:
      // Another family's key reads as absent.
      return { status: 404, body: { error: "Upload not found", code: "upload_not_found" } };
  }
}
