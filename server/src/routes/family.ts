import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { personDto } from "../lib/serialize.js";

export const familyRouter = Router();

/** Family Hub: administrative rather than emotional, hence its own modal. */
familyRouter.get("/family", async (req, res) => {
  const family = req.ctx.family;

  const [people, memoryCount, mediaCount, collectionCount] = await Promise.all([
    prisma.person.findMany({
      where: { familyId: family.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.memory.count({ where: { familyId: family.id } }),
    prisma.media.count({ where: { memory: { familyId: family.id } } }),
    prisma.collection.count({ where: { familyId: family.id } }),
  ]);

  res.json({
    family: {
      id: family.id,
      name: family.name,
      createdAt: family.createdAt.toISOString(),
    },
    members: people.map((p) => ({
      ...personDto(p),
      // Permissions are display-only until accounts exist.
      permission: p.role === "PARENT" ? "Owner" : p.role === "CHILD" ? "No access yet" : "Can add memories",
    })),
    stats: { memoryCount, mediaCount, collectionCount, personCount: people.length },
    subscription: { plan: "Keepsake Family (preview)", status: "Not billed in this build" },
  });
});

const invite = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().optional(),
  role: z.enum(["PARENT", "GRANDPARENT", "RELATIVE", "COLLABORATOR"]).default("COLLABORATOR"),
});

/**
 * v0 has no auth, so an "invitation" just records the intent and returns a
 * placeholder link. Real invites need accounts, tokens, and permissions.
 */
familyRouter.post("/family/invites", async (req, res) => {
  const family = req.ctx.family;
  const parsed = invite.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.activityEvent.create({
    data: {
      familyId: family.id,
      kind: "invite_sent",
      message: `${parsed.data.name} was invited to the family archive.`,
    },
  });

  res.status(201).json({
    invite: {
      name: parsed.data.name,
      role: parsed.data.role,
      link: `https://keepsake.local/join/${family.id.slice(-6)}`,
      note: "Placeholder link — invitations are not deliverable until accounts exist.",
    },
  });
});
