import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

/**
 * The two routes that exist *before* a family does. Everything else in the API
 * is scoped to one archive; these answer "who am I" and "make me one", so they
 * run behind `requireUser` alone.
 */
export const accountRouter = Router();

accountRouter.get("/me", async (req, res) => {
  const { user, emailVerified } = req.ctx;

  const memberships = await prisma.familyMembership.findMany({
    where: { userId: user.id },
    include: { family: true },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified,
      createdAt: user.createdAt.toISOString(),
    },
    memberships: memberships.map((m) => ({
      familyId: m.familyId,
      familyName: m.family.name,
      role: m.role,
      personId: m.personId,
    })),
  });
});

const newFamily = z.object({
  name: z.string().trim().min(1).max(80),
  /** How the creator appears inside the archive; defaults to their account name. */
  displayName: z.string().trim().min(1).max(80).optional(),
});

/**
 * Start an archive. The creator becomes its OWNER and gains a Person row, so
 * they can be an author of and a participant in memories from the first one.
 */
accountRouter.post("/families", async (req, res) => {
  const { user } = req.ctx;
  const parsed = newFamily.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Person.userId is globally unique — one login maps to at most one Person
  // across the whole database — so a user's second family gets a Person with
  // no back-link. FamilyMembership.personId is the per-family link and is the
  // one every caller should read; the column stays until a later migration
  // drops it.
  const alreadyLinked = await prisma.person.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  const family = await prisma.$transaction(async (tx) => {
    const created = await tx.family.create({ data: { name: parsed.data.name } });

    const person = await tx.person.create({
      data: {
        familyId: created.id,
        name: parsed.data.displayName ?? user.displayName,
        role: "PARENT",
        relation: null,
        avatarSeed: `person-${created.id}`,
        userId: alreadyLinked ? null : user.id,
        sortOrder: 0,
      },
    });

    await tx.familyMembership.create({
      data: { userId: user.id, familyId: created.id, role: "OWNER", personId: person.id },
    });

    await tx.activityEvent.create({
      data: {
        familyId: created.id,
        actorId: person.id,
        kind: "family_created",
        message: `${person.name} started the ${created.name} archive.`,
      },
    });

    return created;
  });

  res.status(201).json({
    family: { id: family.id, name: family.name, createdAt: family.createdAt.toISOString() },
    role: "OWNER",
  });
});
