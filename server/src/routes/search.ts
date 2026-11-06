import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  collectionDto,
  collectionInclude,
  mediaInclude,
  memoryCardDtoWithExcerpt,
  memoryCardDtos,
  personDto,
} from "../lib/serialize.js";

export const searchRouter = Router();

const query = z.object({ q: z.string().trim().max(120).default("") });

type MemoryHit = { id: string; rank: number; snippet: string | null };

searchRouter.get("/search", async (req, res) => {
  const family = req.ctx.family;
  const parsed = query.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const q = parsed.data.q;

  if (q.length < 2) {
    return res.json({ q, memories: [], people: [], collections: [], total: 0 });
  }

  const contains = { contains: q, mode: "insensitive" as const };

  const [memories, people, collections] = await Promise.all([
    searchMemories(family.id, q),
    prisma.person.findMany({
      where: { familyId: family.id, OR: [{ name: contains }, { relation: contains }] },
      take: 10,
    }),
    prisma.collection.findMany({
      where: { familyId: family.id, OR: [{ name: contains }, { description: contains }] },
      take: 10,
      include: collectionInclude,
    }),
  ]);

  res.json({
    q,
    memories,
    people: people.map(personDto),
    collections: collections.map(collectionDto),
    total: memories.length + people.length + collections.length,
  });
});

async function searchMemories(familyId: string, q: string) {
  const hits = await prisma.$queryRaw<MemoryHit[]>`
    WITH parsed AS (SELECT websearch_to_tsquery('english', ${q}) AS query)
    SELECT
      m."id" AS id,
      ts_rank_cd(m."searchVector", parsed.query) AS rank,
      ts_headline(
        'english',
        coalesce(m."story", m."transcript", ''),
        parsed.query,
        'MaxWords=20, MinWords=8, StartSel="", StopSel=""'
      ) AS snippet
    FROM "Memory" m, parsed
    WHERE m."familyId" = ${familyId}
      AND parsed.query::text <> ''
      AND m."searchVector" @@ parsed.query
    ORDER BY rank DESC, m."occurredAt" DESC
    LIMIT 30
  `;

  // websearch_to_tsquery parses all-stopword input ("the") to an empty query
  // that never matches; that's a parsing dead end, not "no results".
  if (hits.length === 0 && (await isEmptyTsQuery(q))) {
    return searchMemoriesByIlike(familyId, q);
  }

  if (hits.length === 0) return [];

  const snippetById = new Map(hits.map((h) => [h.id, h.snippet]));
  const records = await prisma.memory.findMany({
    where: { id: { in: hits.map((h) => h.id) }, familyId },
    include: { media: mediaInclude, participants: { include: { person: true } } },
  });
  const byId = new Map(records.map((m) => [m.id, m]));

  // Prisma's `in` filter makes no ordering guarantee; keep the rank order.
  return Promise.all(
    hits
      .map((h) => byId.get(h.id))
      .filter((m): m is NonNullable<typeof m> => m != null)
      .map((m) => memoryCardDtoWithExcerpt(m, snippetById.get(m.id))),
  );
}

async function isEmptyTsQuery(q: string) {
  const [{ text }] = await prisma.$queryRaw<{ text: string }[]>`
    SELECT websearch_to_tsquery('english', ${q})::text AS text
  `;
  return text === "";
}

function searchMemoriesByIlike(familyId: string, q: string) {
  const contains = { contains: q, mode: "insensitive" as const };
  return prisma.memory
    .findMany({
      where: {
        familyId,
        OR: [
          { title: contains },
          { story: contains },
          { transcript: contains },
          { location: contains },
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: 30,
      include: { media: mediaInclude, participants: { include: { person: true } } },
    })
    .then((records) => memoryCardDtos(records));
}
