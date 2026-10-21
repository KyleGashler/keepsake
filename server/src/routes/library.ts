import type { Pillar, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { COLLECTION_ICONS, DEFAULT_COLLECTION_COLOR, DEFAULT_COLLECTION_ICON } from "../lib/child-collections.js";
import { childSummaries, childSummary } from "../lib/children.js";
import { prisma } from "../lib/prisma.js";
import { collectionDto, collectionInclude, imageUrl, memoryCardDtos, personDto } from "../lib/serialize.js";
import { imageKeyError, imageKeyProblem, signedImageUrl } from "../lib/upload-keys.js";

export const libraryRouter = Router();

const PILLARS = [
  {
    key: "ARRIVAL_STORIES" as const,
    name: "Arrival Stories",
    tagline: "The story of waiting, meeting, and falling in love.",
    description:
      "The anticipation, preparation, and transformation surrounding a child's arrival — however they came to you.",
    /** Arrival Stories and Child Profiles are browsed one child at a time. */
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

/**
 * A pillar card. `coverUrl` is the family's own cover when they've set one
 * (`customCover`), else the generated default.
 */
async function pillarDto(p: (typeof PILLARS)[number], coverKey: string | undefined, collectionCount: number) {
  return {
    ...p,
    collectionCount,
    coverUrl: coverKey ? await signedImageUrl(coverKey) : imageUrl(p.coverSeed, 1000, 700),
    customCover: Boolean(coverKey),
  };
}

async function pillarsFor(familyId: string) {
  const [counts, covers] = await Promise.all([
    prisma.collection.groupBy({
      by: ["pillar"],
      where: { familyId },
      _count: { _all: true },
    }),
    prisma.pillarCover.findMany({ where: { familyId } }),
  ]);
  return Promise.all(
    PILLARS.map((p) =>
      pillarDto(
        p,
        covers.find((c) => c.pillar === p.key)?.storageKey,
        counts.find((c) => c.pillar === p.key)?._count._all ?? 0,
      ),
    ),
  );
}

/** Children in the order the Library lists them. */
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

/** Set a pillar card's cover to an upload the family has finalized. */
libraryRouter.put("/library/pillars/:key/cover", async (req, res) => {
  const family = req.ctx.family;
  const pillar = pillarParam.safeParse(req.params.key);
  if (!pillar.success) return res.status(404).json({ error: "Unknown pillar" });
  const body = coverBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });

  const problem = await imageKeyProblem(body.data.key, family.id);
  if (problem) {
    const { status, body: error } = imageKeyError(problem);
    return res.status(status).json(error);
  }

  await prisma.pillarCover.upsert({
    where: { familyId_pillar: { familyId: family.id, pillar: pillar.data } },
    create: { familyId: family.id, pillar: pillar.data, storageKey: body.data.key },
    update: { storageKey: body.data.key },
  });
  const pillars = await pillarsFor(family.id);
  res.json({ pillar: pillars.find((p) => p.key === pillar.data) });
});

/** Back to the generated default. The uploaded original is kept, as always. */
libraryRouter.delete("/library/pillars/:key/cover", async (req, res) => {
  const family = req.ctx.family;
  const pillar = pillarParam.safeParse(req.params.key);
  if (!pillar.success) return res.status(404).json({ error: "Unknown pillar" });

  await prisma.pillarCover.deleteMany({ where: { familyId: family.id, pillar: pillar.data } });
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
      where: { familyId: family.id, personId: child.id, pillar: "CHILD_PROFILES" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: collectionInclude,
    }),
  ]);
  res.json({ child: summary, collections: collections.map(collectionDto) });
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
    where: {
      familyId: family.id,
      ...(pillar ? { pillar } : {}),
      ...(personId ? { personId } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: collectionInclude,
  });

  res.json({ collections: collections.map(collectionDto) });
});

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

const archiveQuery = z.object({
  q: z.string().trim().max(120).optional(),
  year: z.coerce.number().int().min(1800).max(3000).optional(),
  /** The viewer's IANA time zone; years are their calendar years. UTC without one. */
  tz: z.string().max(64).refine(isTimeZone, "Unknown time zone").optional(),
});

/**
 * One collection's archive: newest first, optionally narrowed by a text match
 * and a calendar year. `years` counts what `q` matches but ignores `year`, so
 * the chips don't vanish when one is picked.
 *
 * Years are calendar years in the viewer's `tz`, because the app shows a
 * memory's date in local time: a memory from New Year's Eve evening in New
 * York is in the viewer's 2025 (chip, heading and date alike), even though
 * it's already 2026 in UTC.
 */
libraryRouter.get("/collections/:id", async (req, res) => {
  const family = req.ctx.family;
  const parsed = archiveQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { q, year, tz = "UTC" } = parsed.data;

  const collection = await prisma.collection.findFirst({
    where: { id: req.params.id, familyId: family.id },
    include: collectionInclude,
  });
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  const contains = q ? { contains: q, mode: "insensitive" as const } : null;
  const where: Prisma.MemoryWhereInput = {
    familyId: family.id,
    deletedAt: null,
    collections: { some: { collectionId: collection.id } },
    ...(contains
      ? { OR: [{ title: contains }, { story: contains }, { transcript: contains }, { location: contains }] }
      : {}),
  };

  // One collection's dates are few; bucketing them here keeps the time zone
  // arithmetic in Intl rather than in SQL.
  const [dates, child] = await Promise.all([
    prisma.memory.findMany({ where, select: { id: true, occurredAt: true } }),
    collection.person?.role === "CHILD" ? childSummary(family.id, collection.person) : null,
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
    include: { media: true, participants: { include: { person: true } } },
  });
  // A fresh array, so sorting in place is fine (and ES2022 has no toSorted).
  // oxlint-disable-next-line unicorn/no-array-sort
  const years = [...byYear].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year);

  res.json({
    collection: collectionDto(collection),
    child,
    years,
    memories: await memoryCardDtos(memories),
  });
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
