import { Router } from "express";
import { z } from "zod";
import { currentFamily, prisma } from "../lib/prisma.js";
import { collectionDto, memoryCardDto, personDto } from "../lib/serialize.js";

export const searchRouter = Router();

const query = z.object({ q: z.string().trim().max(120).default("") });

/**
 * One universal search across the whole archive — memories, people,
 * collections, transcripts, locations. Postgres ILIKE is plenty at this size;
 * semantic/vector search is a later conversation.
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
    prisma.memory.findMany({
      where: {
        familyId: family.id,
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
    }),
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
    memories: memories.map(memoryCardDto),
    people: people.map(personDto),
    collections: collections.map(collectionDto),
    total: memories.length + people.length + collections.length,
  });
});
