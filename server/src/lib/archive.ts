import type { Collection, Person, Prisma } from "@prisma/client";
import { z } from "zod";
import { childSummaryOf } from "./children.js";
import { prisma } from "./prisma.js";
import { collectionDto, mediaInclude, memoryCardDtos } from "./serialize.js";

/** The calendar year `date` falls in on a wall clock in `timeZone` (an IANA name). */
function yearIn(date: Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date));
}

function isTimeZone(tz: string) {
  try {
    return Boolean(new Intl.DateTimeFormat("en-US", { timeZone: tz }));
  } catch {
    return false;
  }
}

export const archiveFilters = z.object({
  q: z.string().trim().max(120).optional(),
  year: z.coerce.number().int().min(1800).max(3000).optional(),
  /** The viewer's IANA time zone; years are their calendar years. UTC without one. */
  tz: z.string().max(64).refine(isTimeZone, "Unknown time zone").optional(),
});

export type ArchiveFilters = z.infer<typeof archiveFilters>;

/** Memories whose title, story, transcript or location contain `q`, ignoring case. */
export function memoryTextMatch(q: string | undefined): Prisma.MemoryWhereInput {
  if (!q) return {};
  const contains = { contains: q, mode: "insensitive" as const };
  return { OR: [{ title: contains }, { story: contains }, { transcript: contains }, { location: contains }] };
}

/**
 * One collection's archive: newest first, optionally narrowed by a text match
 * and a calendar year, and to `onlyIds` when given. `years` counts what `q`
 * matches but ignores `year`, so the chips don't vanish when one is picked.
 *
 * Years are calendar years in the viewer's `tz`, because the app shows a
 * memory's date in local time: a memory from New Year's Eve evening in New
 * York is in the viewer's 2025 (chip, heading and date alike), even though
 * it's already 2026 in UTC.
 */
export async function collectionArchive(
  familyId: string,
  collection: Collection & { person: Person | null; _count: { memories: number }; parent: { name: string } | null },
  { q, year, tz = "UTC" }: ArchiveFilters,
  onlyIds?: string[],
) {
  const where: Prisma.MemoryWhereInput = {
    familyId,
    collections: { some: { collectionId: collection.id } },
    ...(onlyIds ? { id: { in: onlyIds } } : {}),
    ...memoryTextMatch(q),
  };

  // One collection's dates are few; bucketing them here keeps the time zone
  // arithmetic in Intl rather than in SQL.
  const [dates, child] = await Promise.all([
    prisma.memory.findMany({ where, select: { id: true, occurredAt: true } }),
    childSummaryOf(familyId, collection.person),
  ]);
  const byYear = new Map<number, number>();
  const idsInYear: string[] = [];
  for (const { id, occurredAt } of dates) {
    const y = yearIn(occurredAt, tz);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
    if (y === year) idsInYear.push(id);
  }
  const memories = await prisma.memory.findMany({
    where: year === undefined ? where : { ...where, id: { in: idsInYear } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: { media: mediaInclude, participants: { include: { person: true } } },
  });
  // A fresh array, so sorting in place is fine (and ES2022 has no toSorted).
  // oxlint-disable-next-line unicorn/no-array-sort
  const years = [...byYear].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year);

  return {
    collection: collectionDto(collection),
    child,
    years,
    memories: await memoryCardDtos(memories),
  };
}
