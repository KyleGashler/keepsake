import { Router } from "express";
import { z } from "zod";
import { jobQueue } from "../jobs/index.js";
import { deleteAccount, deletionPreview } from "../lib/account-deletion.js";
import { prisma } from "../lib/prisma.js";

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
  displayName: z.string().trim().min(1).max(80).optional(),
});

accountRouter.post("/families", async (req, res) => {
  const { user } = req.ctx;
  const parsed = newFamily.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Person.userId is globally unique, so a user's second family gets a Person
  // with no back-link; FamilyMembership.personId is the per-family link.
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

accountRouter.get("/me/deletion", async (req, res) => {
  res.json(await deletionPreview(req.ctx.user.id));
});

// The Firebase identity isn't deleted here (the server holds no credentials
// for it); the client deletes it once this answers.
accountRouter.delete("/me", async (req, res) => {
  const { user } = req.ctx;
  const result = await deleteAccount(jobQueue(), user.id);
  if (!result.ok) {
    if (result.reason === "not_an_owner") return res.status(403).json({ error: "not_an_owner" });
    return res.status(404).json({ error: "not_found" });
  }
  req.log.info({ userId: user.id, deletedFamilies: result.deleted, leftFamilies: result.left }, "account deleted");
  res.status(204).end();
});
