import type { Pillar } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireContributor } from "../auth/middleware.js";
import { COLLECTION_ICONS, DEFAULT_COLLECTION_COLOR, DEFAULT_COLLECTION_ICON } from "../lib/child-collections.js";
import { archiveFilters, collectionArchive } from "../lib/archive.js";
import { birthdaysMemoryCount } from "../lib/birthdays.js";
import { childSummaries, childSummary } from "../lib/children.js";
import { prisma } from "../lib/prisma.js";
import { pictureUrl, setPicture } from "../lib/pictures.js";
import { collectionDto, collectionInclude, imageUrl, personDto } from "../lib/serialize.js";
import { imageKeyError } from "../lib/upload-keys.js";

export const libraryRouter = Router();

const PILLARS = [
  {
    key: "ARRIVAL_STORIES" as const,
    name: "Arrival Stories",
    tagline: "The story of waiting, meeting, and falling in love.",
    description:
      "The anticipation, preparation, and transformation surrounding a child's arrival — however they came to you.",
    selectsPerson: true,
    coverSeed: "pillar-arrival",
  },
  {
    key: "CHILD_PROFILES" as const,
    name: "Child Profiles",
    tagline: "Every child's story, captured little by little.",
    description: "Milestones, everyday moments, quotes, character, and the person they're becoming.",
    selectsPerson: true,
    coverSeed: "pillar-children",
  },
  {
    key: "FAMILY_LIFE" as const,
    name: "Family Life",
    tagline: "The shared memories that become part of who we are.",
    description: "The shared experiences, traditions, and relationships that make your family yours.",
    selectsPerson: false,
    coverSeed: "pillar-family",
  },
];

const PILLAR_KEYS = ["ARRIVAL_STORIES", "CHILD_PROFILES", "FAMILY_LIFE"] as const satisfies readonly Pillar[];

async function pillarDto(
  p: (typeof PILLARS)[number],
  cover: { storageKey: string; derivedKey: string | null } | undefined,
  memoryCount: number,
) {
  return {
    ...p,
    memoryCount,
    coverUrl: (cover && (await pictureUrl(cover, "DISPLAY"))) ?? imageUrl(p.coverSeed, 1000, 700),
    customCover: Boolean(cover),
  };
}

async function pillarsFor(familyId: string) {
  const [counts, covers] = await Promise.all([
    Promise.all(
      PILLARS.map((p) =>
        prisma.memory.count({ where: { familyId, collections: { some: { collection: { pillar: p.key } } } } }),
      ),
    ),
    prisma.pillarCover.findMany({ where: { familyId } }),
  ]);
  return Promise.all(
    PILLARS.map((p, i) =>
      pillarDto(
        p,
        covers.find((c) => c.pillar === p.key),
        counts[i],
      ),
    ),
  );
}

function findChildren(familyId: string) {
  return prisma.person.findMany({
    where: { familyId, role: "CHILD" },
    orderBy: [{ sortOrder: "asc" }, { birthDate: "asc" }, { createdAt: "asc" }],
  });
}

libraryRouter.get("/library", async (req, res) => {
  const family = req.ctx.family;
  const [pillars, children] = await Promise.all([pillarsFor(family.id), findChildren(family.id)]);
  res.json({ pillars, children: children.map(personDto) });
});

const pillarParam = z.enum(PILLAR_KEYS);
const coverBody = z.object({ key: z.string().min(1).max(512) });

libraryRouter.put("/library/pillars/:key/cover", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const pillar = pillarParam.safeParse(req.params.key);
  if (!pillar.success) return res.status(404).json({ error: "Unknown pillar" });
  const body = coverBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const set = await setPicture(family.id, { pillar: pillar.data }, body.data.key);
  if (!set.ok) {
    const { status, body: error } = imageKeyError(set.problem);
    return res.status(status).json(error);
  }
  const pillars = await pillarsFor(family.id);
  res.json({ pillar: pillars.find((p) => p.key === pillar.data) });
});

libraryRouter.delete("/library/pillars/:key/cover", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const pillar = pillarParam.safeParse(req.params.key);
  if (!pillar.success) return res.status(404).json({ error: "Unknown pillar" });

  await setPicture(family.id, { pillar: pillar.data }, null);
  const pillars = await pillarsFor(family.id);
  res.json({ pillar: pillars.find((p) => p.key === pillar.data) });
});

libraryRouter.get("/children", async (req, res) => {
  const family = req.ctx.family;
  const children = await findChildren(family.id);
  res.json({ children: await childSummaries(family.id, children) });
});

libraryRouter.get("/children/:id", async (req, res) => {
  const family = req.ctx.family;
  const child = await prisma.person.findFirst({
    where: { id: req.params.id, familyId: family.id, role: "CHILD" },
  });
  if (!child) return res.status(404).json({ error: "Child not found" });

  const [summary, collections] = await Promise.all([
    childSummary(family.id, child),
    prisma.collection.findMany({
      where: { familyId: family.id, personId: child.id, pillar: "CHILD_PROFILES", parentId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: collectionInclude,
    }),
  ]);
  const dtos = await Promise.all(
    collections.map(async (c) =>
      c.kind === "birthdays"
        ? { ...collectionDto(c), memoryCount: await birthdaysMemoryCount(family.id, c.id) }
        : collectionDto(c),
    ),
  );
  res.json({ child: summary, collections: dtos });
});

const collectionQuery = z.object({
  pillar: z.enum(PILLAR_KEYS).optional(),
  personId: z.string().optional(),
});

libraryRouter.get("/collections", async (req, res) => {
  const family = req.ctx.family;
  const parsed = collectionQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { pillar, personId } = parsed.data;

  const collections = await prisma.collection.findMany({
    // A birthday holds categories, never memories, so no picker offers one.
    where: {
      familyId: family.id,
      birthday: null,
      ...(pillar ? { pillar } : {}),
      ...(personId ? { personId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: collectionInclude,
  });

  res.json({ collections: collections.map(collectionDto) });
});

libraryRouter.get("/collections/:id", async (req, res) => {
  const family = req.ctx.family;
  const parsed = archiveFilters.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const collection = await prisma.collection.findFirst({
    where: { id: req.params.id, familyId: family.id },
    include: collectionInclude,
  });
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  res.json(await collectionArchive(family.id, collection, parsed.data));
});

const newCollection = z.object({
  name: z.string().min(1).max(80),
  pillar: z.enum(PILLAR_KEYS),
  personId: z.string().optional(),
  description: z.string().max(400).optional(),
  icon: z.enum(COLLECTION_ICONS).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "color is a #RRGGBB hex")
    .optional(),
});

libraryRouter.post("/collections", requireContributor, async (req, res) => {
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
    where: {
      familyId: family.id,
      pillar: parsed.data.pillar,
      ...(parsed.data.personId ? { personId: parsed.data.personId } : {}),
    },
    _max: { sortOrder: true },
  });

  const collection = await prisma.collection.create({
    data: {
      familyId: family.id,
      name: parsed.data.name,
      pillar: parsed.data.pillar,
      personId: parsed.data.personId ?? null,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? DEFAULT_COLLECTION_ICON,
      color: parsed.data.color?.toUpperCase() ?? DEFAULT_COLLECTION_COLOR,
      isDefault: false,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      coverSeed: `collection-${Date.now()}`,
    },
    include: collectionInclude,
  });

  res.status(201).json({ collection: collectionDto(collection) });
});

const editCollection = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  icon: z.enum(COLLECTION_ICONS).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "color is a #RRGGBB hex")
    .optional(),
});

// Defaults are known by `kind`, so a renamed one is still drawn as its kind and the boot-time backfill leaves it alone.
libraryRouter.patch("/collections/:id", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = editCollection.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, description, icon, color } = parsed.data;

  const existing = await prisma.collection.findFirst({
    where: { id: req.params.id, familyId: family.id },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Collection not found" });

  const collection = await prisma.collection.update({
    where: { id: existing.id },
    data: {
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description: description || null }),
      ...(icon === undefined ? {} : { icon }),
      ...(color === undefined ? {} : { color: color.toUpperCase() }),
    },
    include: collectionInclude,
  });
  res.json({ collection: collectionDto(collection) });
});

// The memories stay in the archive; only this filing goes.
libraryRouter.delete("/collections/:id", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const collection = await prisma.collection.findFirst({
    where: { id: req.params.id, familyId: family.id },
    select: { id: true },
  });
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  await prisma.collection.delete({ where: { id: collection.id } });
  res.status(204).end();
});

async function findFiling(familyId: string, collectionId: string, memoryId: string) {
  const [collection, memory] = await Promise.all([
    prisma.collection.findFirst({ where: { id: collectionId, familyId }, select: { id: true } }),
    prisma.memory.findFirst({ where: { id: memoryId, familyId }, select: { id: true } }),
  ]);
  return collection && memory ? { collectionId: collection.id, memoryId: memory.id } : null;
}

libraryRouter.put("/collections/:id/memories/:memoryId", requireContributor, async (req, res) => {
  const filing = await findFiling(req.ctx.family.id, req.params.id, req.params.memoryId);
  if (!filing) return res.status(404).json({ error: "Not found" });
  await prisma.memoryCollection.createMany({ data: [filing], skipDuplicates: true });
  res.status(204).end();
});

libraryRouter.delete("/collections/:id/memories/:memoryId", requireContributor, async (req, res) => {
  const filing = await findFiling(req.ctx.family.id, req.params.id, req.params.memoryId);
  if (!filing) return res.status(404).json({ error: "Not found" });
  await prisma.memoryCollection.deleteMany({ where: filing });
  res.status(204).end();
});
