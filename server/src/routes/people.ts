import { Router } from "express";
import { z } from "zod";
import { requireContributor } from "../auth/middleware.js";
import { ensureChildCollections } from "../lib/child-collections.js";
import { childSummary } from "../lib/children.js";
import { prisma } from "../lib/prisma.js";
import { mediaInclude, memoryCardDtos, personDto } from "../lib/serialize.js";
import { imageKeyError, imageKeyProblem, signedImageUrl } from "../lib/upload-keys.js";

export const peopleRouter = Router();

peopleRouter.get("/people", async (req, res) => {
  const family = req.ctx.family;
  const people = await prisma.person.findMany({
    where: { familyId: family.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json({ people: people.map(personDto) });
});

peopleRouter.get("/people/:id", async (req, res) => {
  const family = req.ctx.family;
  const person = await prisma.person.findFirst({
    where: { id: req.params.id, familyId: family.id },
  });
  if (!person) return res.status(404).json({ error: "Person not found" });

  const appearsIn = {
    familyId: family.id,
    deletedAt: null,
    participants: { some: { personId: person.id } },
  };
  const [memories, memoryCount, collections] = await Promise.all([
    prisma.memory.findMany({
      where: appearsIn,
      orderBy: { occurredAt: "desc" },
      take: 24,
      include: { media: mediaInclude, participants: { include: { person: true } } },
    }),
    prisma.memory.count({ where: appearsIn }),
    prisma.collection.findMany({
      where: { familyId: family.id, personId: person.id },
      orderBy: [{ pillar: "asc" }, { sortOrder: "asc" }],
    }),
  ]);

  res.json({
    person: personDto(person),
    memoryCount,
    memories: await memoryCardDtos(memories),
    collections: collections.map((c) => ({ id: c.id, name: c.name, pillar: c.pillar })),
  });
});

const newPerson = z.object({
  name: z.string().min(1).max(80),
  role: z.enum(["PARENT", "CHILD", "GRANDPARENT", "RELATIVE", "COLLABORATOR"]),
  relation: z.string().max(40).optional(),
  birthDate: z.string().datetime().optional(),
});

peopleRouter.post("/people", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = newPerson.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const max = await prisma.person.aggregate({
    where: { familyId: family.id },
    _max: { sortOrder: true },
  });

  // A child arrives with their default collections, in the same transaction:
  // a child with an empty Library is not a state anyone should see.
  const person = await prisma.$transaction(async (tx) => {
    const created = await tx.person.create({
      data: {
        familyId: family.id,
        name: parsed.data.name,
        role: parsed.data.role,
        relation: parsed.data.relation ?? null,
        birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
        avatarSeed: `person-${Date.now()}`,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    if (created.role === "CHILD") await ensureChildCollections(family.id, created.id, tx);
    return created;
  });

  await prisma.activityEvent.create({
    data: {
      familyId: family.id,
      actorId: person.id,
      kind: "person_added",
      message: `${person.name} was added to the family.`,
    },
  });

  res.status(201).json({
    person: personDto(person),
    child: person.role === "CHILD" ? await childSummary(family.id, person) : null,
  });
});

const editPerson = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** ISO datetime, or null to clear. */
  birthDate: z.string().datetime().nullable().optional(),
  /** A finalized upload key (an image in this family's prefix), or null to clear. */
  photoKey: z.string().min(1).max(512).nullable().optional(),
});

/**
 * Edit a person: the child edit sheet's name, birthday and profile photo.
 * Absent fields are left alone; null clears a nullable one. Clearing a photo
 * only drops the pointer — the uploaded original is kept.
 */
peopleRouter.patch("/people/:id", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = editPerson.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, birthDate, photoKey } = parsed.data;

  const existing = await prisma.person.findFirst({
    where: { id: req.params.id, familyId: family.id },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Person not found" });

  if (photoKey) {
    const problem = await imageKeyProblem(photoKey, family.id);
    if (problem) {
      const { status, body } = imageKeyError(problem);
      return res.status(status).json(body);
    }
  }

  const person = await prisma.person.update({
    where: { id: existing.id },
    data: {
      ...(name === undefined ? {} : { name }),
      ...(birthDate === undefined ? {} : { birthDate: birthDate ? new Date(birthDate) : null }),
      ...(photoKey === undefined ? {} : { photoKey }),
    },
  });

  res.json({
    person: { ...personDto(person), photoUrl: person.photoKey ? await signedImageUrl(person.photoKey) : null },
    child: person.role === "CHILD" ? await childSummary(family.id, person) : null,
  });
});
