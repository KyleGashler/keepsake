import type { Collection, Memory, Person } from "@prisma/client";
import { prisma } from "./prisma.js";
import { mediaInclude, memoryCardDtos, memoryDto, type MediaRow } from "./serialize.js";

/** How many related memories a memory page shows. */
export const MAX_RELATED = 8;

const cardInclude = { media: mediaInclude, participants: { include: { person: true } } } as const;

type DetailMemory = Memory & {
  media: MediaRow[];
  author: Person | null;
  participants: { personId: string; person: Person }[];
  collections: { collectionId: string; collection: Collection }[];
};

/** A link is stored once, smaller id first (the table's CHECK enforces it). */
export function linkPair(a: string, b: string) {
  return a < b ? { memoryId: a, linkedId: b } : { memoryId: b, linkedId: a };
}

/**
 * "Related Memories": the ones a person linked by hand first (oldest link
 * first), then suggestions that share a collection or a person, nearest in
 * date either side. Never the memory itself, never another family's. At most
 * MAX_RELATED. `linkedIds` says which memories were
 * linked by hand (all of them, even past MAX_RELATED), so a page can offer to
 * unlink those and not the suggestions.
 */
export async function relatedMemories(familyId: string, memory: DetailMemory) {
  const links = await prisma.memoryLink.findMany({
    where: { OR: [{ memoryId: memory.id }, { linkedId: memory.id }] },
    orderBy: { createdAt: "asc" },
  });
  const linkedIds = links.map((l) => (l.memoryId === memory.id ? l.linkedId : l.memoryId));

  const linkedRows = linkedIds.length
    ? await prisma.memory.findMany({
        where: { id: { in: linkedIds }, familyId },
        include: cardInclude,
      })
    : [];
  const byId = new Map(linkedRows.map((m) => [m.id, m]));
  const linked = linkedIds.map((id) => byId.get(id)).filter((m) => m !== undefined).slice(0, MAX_RELATED);

  // Only links this family can see (a link row can't outlive its memories:
  // both ends cascade).
  const live = linkedIds.filter((id) => byId.has(id));

  const room = MAX_RELATED - linked.length;
  const collectionIds = memory.collections.map((c) => c.collectionId);
  const personIds = memory.participants.map((p) => p.personId);
  if (room <= 0 || (collectionIds.length === 0 && personIds.length === 0)) {
    return { related: await memoryCardDtos(linked), linkedIds: live };
  }

  const shares = {
    familyId,
    id: { notIn: [memory.id, ...linkedIds] },
    OR: [
      ...(collectionIds.length ? [{ collections: { some: { collectionId: { in: collectionIds } } } }] : []),
      ...(personIds.length ? [{ participants: { some: { personId: { in: personIds } } } }] : []),
    ],
  };
  // The nearest `room` on each side cover the nearest `room` overall.
  const [before, after] = await Promise.all([
    prisma.memory.findMany({
      where: { ...shares, occurredAt: { lte: memory.occurredAt } },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: room,
      include: cardInclude,
    }),
    prisma.memory.findMany({
      where: { ...shares, occurredAt: { gt: memory.occurredAt } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: room,
      include: cardInclude,
    }),
  ]);
  const at = memory.occurredAt.getTime();
  const distance = (m: Memory) => Math.abs(m.occurredAt.getTime() - at);
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; ES2022 has no toSorted
  const suggested = [...before, ...after].sort((a, b) => distance(a) - distance(b)).slice(0, room);

  return { related: await memoryCardDtos([...linked, ...suggested]), linkedIds: live };
}

/**
 * `GET /api/memories/:id`'s shape: the memory, plus this user's favourite
 * flag, related memories, and which of those were linked by hand.
 */
export async function memoryDetail(familyId: string, userId: string, memory: DetailMemory) {
  const [dto, favorite, { related, linkedIds }] = await Promise.all([
    memoryDto(memory),
    prisma.memoryFavorite.findUnique({
      where: { userId_memoryId: { userId, memoryId: memory.id } },
      select: { memoryId: true },
    }),
    relatedMemories(familyId, memory),
  ]);
  return { ...dto, isFavorite: Boolean(favorite), related, linkedIds };
}
