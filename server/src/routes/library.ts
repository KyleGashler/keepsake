import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { collectionDto, imageUrl, memoryCardDto, personDto } from "../lib/serialize.js";

export const libraryRouter = Router();

const PILLARS = [
  {
    key: "ARRIVAL_STORIES" as const,
    name: "Arrival Stories",
    tagline: "The beginning of every child's story.",
    description:
      "The anticipation, preparation, and transformation surrounding a child's arrival — however they came to you.",
    /** Arrival Stories and Child Profiles are browsed one child at a time. */
    selectsPerson: true,
    coverSeed: "pillar-arrival",
  },
  {
    key: "CHILD_PROFILES" as const,
    name: "Child Profiles",
    tagline: "Where the majority of the app lives over the years.",
    description: "Milestones, everyday moments, quotes, character, and the person they're becoming.",
    selectsPerson: true,
    coverSeed: "pillar-children",
  },
  {
    key: "FAMILY_LIFE" as const,
    name: "Family Life",
    tagline: "What it actually feels like to grow up in your home.",
    description: "The shared experiences, traditions, and relationships that make your family yours.",
    selectsPerson: false,
    coverSeed: "pillar-family",
  },
];

libraryRouter.get("/library", async (req, res) => {
  const family = req.ctx.family;

  const [children, counts] = await Promise.all([
    prisma.person.findMany({
      where: { familyId: family.id, role: "CHILD" },
      orderBy: [{ sortOrder: "asc" }, { birthDate: "asc" }],
    }),
    prisma.collection.groupBy({
      by: ["pillar"],
      where: { familyId: family.id },
      _count: { _all: true },
    }),
  ]);

  res.json({
    pillars: PILLARS.map((p) => ({
      ...p,
      collectionCount: counts.find((c) => c.pillar === p.key)?._count._all ?? 0,
      coverUrl: imageUrl(p.coverSeed, 1000, 700),
    })),
    children: children.map(personDto),
  });
});

const collectionQuery = z.object({
  pillar: z.enum(["ARRIVAL_STORIES", "CHILD_PROFILES", "FAMILY_LIFE"]).optional(),
  personId: z.string().optional(),
});

libraryRouter.get("/collections", async (req, res) => {
  const family = req.ctx.family;
  const parsed = collectionQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { pillar, personId } = parsed.data;

  const collections = await prisma.collection.findMany({
    where: {
      familyId: family.id,
      ...(pillar ? { pillar } : {}),
      ...(personId ? { personId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { memories: true } }, person: true },
  });

  res.json({ collections: collections.map(collectionDto) });
});

libraryRouter.get("/collections/:id", async (req, res) => {
  const family = req.ctx.family;
  const collection = await prisma.collection.findFirst({
    where: { id: req.params.id, familyId: family.id },
    include: { _count: { select: { memories: true } }, person: true },
  });
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  const memories = await prisma.memory.findMany({
    where: { familyId: family.id, collections: { some: { collectionId: collection.id } } },
    orderBy: { occurredAt: "desc" },
    include: { media: true, participants: { include: { person: true } } },
  });

  res.json({
    collection: collectionDto(collection),
    memories: memories.map(memoryCardDto),
  });
});

const newCollection = z.object({
  name: z.string().min(1).max(80),
  pillar: z.enum(["ARRIVAL_STORIES", "CHILD_PROFILES", "FAMILY_LIFE"]),
  personId: z.string().optional(),
  description: z.string().max(400).optional(),
});

/** "Add Collection" — families can shape the archive around their own life. */
libraryRouter.post("/collections", async (req, res) => {
  const family = req.ctx.family;
  const parsed = newCollection.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.personId) {
    const person = await prisma.person.findFirst({
      where: { id: parsed.data.personId, familyId: family.id },
      select: { id: true },
    });
    if (!person) return res.status(400).json({ error: "unknown_reference" });
  }

  const max = await prisma.collection.aggregate({
    where: { familyId: family.id, pillar: parsed.data.pillar },
    _max: { sortOrder: true },
  });

  const collection = await prisma.collection.create({
    data: {
      familyId: family.id,
      name: parsed.data.name,
      pillar: parsed.data.pillar,
      personId: parsed.data.personId ?? null,
      description: parsed.data.description ?? null,
      isDefault: false,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      coverSeed: `collection-${Date.now()}`,
    },
    include: { _count: { select: { memories: true } }, person: true },
  });

  res.status(201).json({ collection: collectionDto(collection) });
});
