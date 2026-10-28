import type { Person } from "@prisma/client";
import { prisma } from "./prisma.js";
import { personDto } from "./serialize.js";
import { signedPictureUrl } from "./upload-keys.js";

/**
 * A child as the Library's child screens show them: the person, their profile
 * photo, and how much of the archive is theirs.
 *
 * - `photoUrl`: the uploaded profile photo at card size (DISPLAY), signed
 *   fresh; null means none, and the client falls back to `avatarUrl`.
 * - `photoThumbUrl`: the same photo at portrait size (THUMB). Each is the
 *   original until `image.derive` has made its renditions.
 * - `collectionCount`: their Child Profiles collections.
 * - `memoryCount`: distinct memories filed in any collection of
 *   theirs (any pillar). A memory shared with a sibling counts for both.
 */
export async function childSummary(familyId: string, p: Person) {
  const [photo, collectionCount, memoryCount] = await Promise.all([
    profilePhotoUrls(p),
    prisma.collection.count({
      where: { familyId, personId: p.id, pillar: "CHILD_PROFILES" },
    }),
    prisma.memory.count({
      where: {
        familyId,
        collections: { some: { collection: { familyId, personId: p.id } } },
      },
    }),
  ]);
  return { ...personDto(p), ...photo, collectionCount, memoryCount };
}

/** A person's profile photo: DISPLAY for cards, THUMB for portraits; nulls when none. */
export async function profilePhotoUrls(p: Pick<Person, "photoKey" | "photoDerivedKey">) {
  const [photoUrl, photoThumbUrl] = await Promise.all([
    signedPictureUrl(p.photoKey, p.photoDerivedKey, "DISPLAY"),
    signedPictureUrl(p.photoKey, p.photoDerivedKey, "THUMB"),
  ]);
  return { photoUrl, photoThumbUrl };
}

export type ChildSummary = Awaited<ReturnType<typeof childSummary>>;

export function childSummaries(familyId: string, people: Person[]) {
  return Promise.all(people.map((p) => childSummary(familyId, p)));
}
