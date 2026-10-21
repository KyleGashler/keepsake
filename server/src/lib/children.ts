import type { Person } from "@prisma/client";
import { prisma } from "./prisma.js";
import { personDto } from "./serialize.js";
import { signedImageUrl } from "./upload-keys.js";

/**
 * A child as the Library's child screens show them: the person, their profile
 * photo, and how much of the archive is theirs.
 *
 * - `photoUrl`: the uploaded profile photo, signed fresh; null means none, and
 *   the client falls back to `avatarUrl`.
 * - `collectionCount`: their Child Profiles collections.
 * - `memoryCount`: distinct, non-deleted memories filed in any collection of
 *   theirs (any pillar). A memory shared with a sibling counts for both.
 */
export async function childSummary(familyId: string, p: Person) {
  const [photoUrl, collectionCount, memoryCount] = await Promise.all([
    p.photoKey ? signedImageUrl(p.photoKey) : null,
    prisma.collection.count({
      where: { familyId, personId: p.id, pillar: "CHILD_PROFILES" },
    }),
    prisma.memory.count({
      where: {
        familyId,
        deletedAt: null,
        collections: { some: { collection: { familyId, personId: p.id } } },
      },
    }),
  ]);
  return { ...personDto(p), photoUrl, collectionCount, memoryCount };
}

export type ChildSummary = Awaited<ReturnType<typeof childSummary>>;

export function childSummaries(familyId: string, people: Person[]) {
  return Promise.all(people.map((p) => childSummary(familyId, p)));
}
