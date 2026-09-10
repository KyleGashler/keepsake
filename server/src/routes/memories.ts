import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hueForSeed } from "../lib/placeholder.js";
import { memoryCardDto, memoryDto } from "../lib/serialize.js";

export const memoriesRouter = Router();

const include = {
  media: { orderBy: { sortOrder: "asc" } },
  author: true,
  participants: { include: { person: true } },
  collections: { include: { collection: true } },
} as const;

const listQuery = z.object({
  collectionId: z.string().optional(),
  personId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

memoriesRouter.get("/memories", async (req, res) => {
  const family = req.ctx.family;
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { collectionId, personId, limit, offset } = parsed.data;

  const where = {
    familyId: family.id,
    ...(collectionId ? { collections: { some: { collectionId } } } : {}),
    ...(personId ? { participants: { some: { personId } } } : {}),
  };

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit,
      skip: offset,
      include: { media: true, participants: { include: { person: true } } },
    }),
    prisma.memory.count({ where }),
  ]);

  res.json({ memories: memories.map(memoryCardDto), total });
});

memoriesRouter.get("/memories/:id", async (req, res) => {
  // findFirst, not findUnique: an id from another family must read as absent,
  // not as forbidden — otherwise the 404/403 split confirms the id exists.
  const memory = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: req.ctx.family.id },
    include,
  });
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  res.json({ memory: memoryDto(memory) });
});

const mediaInput = z.object({
  type: z.enum(["PHOTO", "VIDEO", "AUDIO"]),
  url: z.string().min(1),
  caption: z.string().max(280).optional(),
  width: z.number().int().positive().default(1200),
  height: z.number().int().positive().default(900),
  durationS: z.number().int().positive().optional(),
});

const newMemory = z.object({
  title: z.string().min(1).max(160),
  story: z.string().max(20_000).optional(),
  transcript: z.string().max(50_000).optional(),
  occurredAt: z.string().datetime().optional(),
  location: z.string().max(160).optional(),
  authorId: z.string().optional(),
  participantIds: z.array(z.string()).default([]),
  collectionIds: z.array(z.string()).default([]),
  media: z.array(mediaInput).default([]),
});

memoriesRouter.post("/memories", async (req, res) => {
  const family = req.ctx.family;
  const parsed = newMemory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;

  // Every id the client hands us is a chance to reach into another archive.
  // Confirm each one belongs to this family before it becomes a relation.
  const personIds = [...new Set([...input.participantIds, ...(input.authorId ? [input.authorId] : [])])];
  const [knownPeople, knownCollections] = await Promise.all([
    personIds.length
      ? prisma.person.findMany({
          where: { id: { in: personIds }, familyId: family.id },
          select: { id: true },
        })
      : [],
    input.collectionIds.length
      ? prisma.collection.findMany({
          where: { id: { in: input.collectionIds }, familyId: family.id },
          select: { id: true },
        })
      : [],
  ]);
  if (knownPeople.length !== personIds.length || knownCollections.length !== new Set(input.collectionIds).size) {
    return res.status(400).json({ error: "unknown_reference" });
  }

  const heroSeed = `memory-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const memory = await prisma.memory.create({
    data: {
      familyId: family.id,
      title: input.title,
      story: input.story ?? null,
      transcript: input.transcript ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      location: input.location ?? null,
      authorId: input.authorId ?? null,
      heroSeed,
      paletteHue: hueForSeed(heroSeed),
      brightness: 40 + (heroSeed.length % 40),
      media: {
        create: input.media.map((m, i) => ({
          type: m.type,
          url: m.url,
          caption: m.caption ?? null,
          width: m.width,
          height: m.height,
          durationS: m.durationS ?? null,
          sortOrder: i,
        })),
      },
      participants: { create: input.participantIds.map((personId) => ({ personId })) },
      collections: { create: input.collectionIds.map((collectionId) => ({ collectionId })) },
    },
    include,
  });

  const author = memory.author?.name ?? "Someone";
  await prisma.activityEvent.create({
    data: {
      familyId: family.id,
      actorId: memory.authorId,
      kind: "memory_added",
      message: `${author} added "${memory.title}".`,
    },
  });

  res.status(201).json({ memory: memoryDto(memory) });
});

const editMemory = z.object({
  title: z.string().min(1).max(160).optional(),
  story: z.string().max(20_000).nullable().optional(),
  transcript: z.string().max(50_000).nullable().optional(),
  location: z.string().max(160).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
});

/** AI assists, families decide — every narrative stays editable. */
memoriesRouter.patch("/memories/:id", async (req, res) => {
  const parsed = editMemory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { occurredAt, ...rest } = parsed.data;

  const existing = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: req.ctx.family.id },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Memory not found" });

  const memory = await prisma.memory.update({
    where: { id: existing.id },
    data: { ...rest, ...(occurredAt ? { occurredAt: new Date(occurredAt) } : {}) },
    include,
  });

  res.json({ memory: memoryDto(memory) });
});
