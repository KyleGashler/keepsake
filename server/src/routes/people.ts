import { Router } from "express";
import { z } from "zod";
import { currentFamily, prisma } from "../lib/prisma.js";
import { memoryCardDtos, personDto } from "../lib/serialize.js";

export const peopleRouter = Router();

peopleRouter.get("/people", async (_req, res) => {
  const family = await currentFamily();
  const people = await prisma.person.findMany({
    where: { familyId: family.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json({ people: people.map(personDto) });
});

peopleRouter.get("/people/:id", async (req, res) => {
  const person = await prisma.person.findUnique({ where: { id: req.params.id } });
  if (!person) return res.status(404).json({ error: "Person not found" });

  const [memories, memoryCount, collections] = await Promise.all([
    prisma.memory.findMany({
      where: { participants: { some: { personId: person.id } } },
      orderBy: { occurredAt: "desc" },
      take: 24,
      include: { media: true, participants: { include: { person: true } } },
    }),
    prisma.memory.count({ where: { participants: { some: { personId: person.id } } } }),
    prisma.collection.findMany({
      where: { personId: person.id },
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

peopleRouter.post("/people", async (req, res) => {
  const family = await currentFamily();
  const parsed = newPerson.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const max = await prisma.person.aggregate({
    where: { familyId: family.id },
    _max: { sortOrder: true },
  });

  const person = await prisma.person.create({
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

  await prisma.activityEvent.create({
    data: {
      familyId: family.id,
      actorId: person.id,
      kind: "person_added",
      message: `${person.name} was added to the family.`,
    },
  });

  res.status(201).json({ person: personDto(person) });
});
