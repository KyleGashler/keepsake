import type { Person } from "@prisma/client";
import { prisma } from "./prisma.js";
import { personDto } from "./serialize.js";
import { pictureUrl } from "./pictures.js";

export async function childSummary(familyId: string, p: Person) {
  const [photo, collectionCount, memoryCount] = await Promise.all([
    profilePhotoUrls(p),
    prisma.collection.count({
      where: { familyId, personId: p.id, pillar: "CHILD_PROFILES", parentId: null },
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

export async function profilePhotoUrls(p: Pick<Person, "photoKey" | "photoDerivedKey">) {
  const [photoUrl, photoThumbUrl] = await Promise.all([
    pictureUrl(p, "DISPLAY"),
    pictureUrl(p, "THUMB"),
  ]);
  return { photoUrl, photoThumbUrl };
}

export type ChildSummary = Awaited<ReturnType<typeof childSummary>>;

export function childSummaryOf(familyId: string, person: Person | null) {
  return person?.role === "CHILD" ? childSummary(familyId, person) : null;
}

export function childSummaries(familyId: string, people: Person[]) {
  return Promise.all(people.map((p) => childSummary(familyId, p)));
}
