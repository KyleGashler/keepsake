import { Router } from "express";
import { z } from "zod";
import { currentFamily, prisma } from "../lib/prisma.js";
import { collectionDto, memoryCardDto, memoryCardDtoWithExcerpt, personDto } from "../lib/serialize.js";

export const searchRouter = Router();

const query = z.object({ q: z.string().trim().max(120).default("") });

/** One row of the ranked full-text hit list: id, rank, and a highlighted snippet. */
type MemoryHit = { id: string; rank: number; snippet: string | null };

/**
 * One universal search across the whole archive — memories, people,
 * collections, transcripts, locations.
 *
 * Memories are searched with Postgres full-text search: `Memory.searchVector`
 * is a generated, GIN-indexed tsvector (see the memory_search_vector
 * migration) weighted title > location > story > transcript, queried with
 * `websearch_to_tsquery` so users can type things like `"rainy tuesday"` or
 * `aquarium -rain`. Results are ranked with `ts_rank_cd` and each memory gets
 * a `ts_headline` snippet of the matched terms in context, which overrides
 * the card's default plain-text excerpt.
 *
 * `websearch_to_tsquery` can parse to an *empty* tsquery — typically an
 * all-stopword query like "the" — which would never match anything via `@@`
 * even though the user typed something. Rather than silently returning zero
 * results for that case, we fall back to the old ILIKE OR-clause so a query
 * like "the" still returns whatever plain substring matches exist.
 *
 * People and collections stay on ILIKE: they're small, short-text tables
 * where substring matching is exactly what you want (e.g. partial names),
 * and there's no transcript-sized column to justify an index for them.
 */
searchRouter.get("/search", async (req, res) => {
  const family = await currentFamily();
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
      include: { _count: { select: { memories: true } }, person: true },
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
        'MaxWords=20, MinWords=8'
      ) AS snippet
    FROM "Memory" m, parsed
    WHERE m."familyId" = ${familyId}
      AND m."deletedAt" IS NULL
      AND parsed.query::text <> ''
      AND m."searchVector" @@ parsed.query
    ORDER BY rank DESC, m."occurredAt" DESC
    LIMIT 30
  `;

  // `websearch_to_tsquery` parses to an empty query for input that's nothing
  // but stopwords/punctuation (e.g. "the"). An empty tsquery never matches
  // anything, so `hits` above is unconditionally empty in that case — but
  // that's a parsing dead-end, not "no results", so fall back to ILIKE.
  if (hits.length === 0 && (await isEmptyTsQuery(q))) {
    return searchMemoriesByIlike(familyId, q);
  }

  if (hits.length === 0) return [];

  const snippetById = new Map(hits.map((h) => [h.id, h.snippet]));
  const records = await prisma.memory.findMany({
    where: { id: { in: hits.map((h) => h.id) } },
    include: { media: true, participants: { include: { person: true } } },
  });
  const byId = new Map(records.map((m) => [m.id, m]));

  // Preserve the rank order from the raw query — Prisma's `in` filter makes
  // no ordering guarantee of its own.
  return hits
    .map((h) => byId.get(h.id))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => memoryCardDtoWithExcerpt(m, snippetById.get(m.id)));
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
        deletedAt: null,
        OR: [
          { title: contains },
          { story: contains },
          { transcript: contains },
          { location: contains },
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: 30,
      include: { media: true, participants: { include: { person: true } } },
    })
    .then((records) => records.map((m) => memoryCardDto(m)));
}
