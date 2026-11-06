import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import { emailSender } from "../email/index.js";
import { jobQueue } from "../jobs/index.js";
import { deleteFamily } from "../lib/account-deletion.js";
import { errorMessage } from "../lib/errors.js";
import {
  INVITE_TTL_MS,
  ROLE_LABELS,
  inviteDto,
  inviteEmail,
  inviteStatus,
  newInviteToken,
  pendingInviteWhere,
} from "../lib/invites.js";
import { prisma } from "../lib/prisma.js";
import { personDto } from "../lib/serialize.js";
import { memberName } from "./invites.js";

export const familyRouter = Router();

familyRouter.get("/family", async (req, res) => {
  const { family, role, user } = req.ctx;
  const isOwner = role === "OWNER";

  const [memberships, people, memoryCount, mediaCount, collectionCount] = await Promise.all([
    prisma.familyMembership.findMany({
      where: { familyId: family.id },
      include: { user: true, person: true },
      // Postgres orders an enum by declaration: owners, contributors, viewers.
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    prisma.person.findMany({
      where: { familyId: family.id },
      include: { membership: { select: { userId: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.memory.count({ where: { familyId: family.id } }),
    prisma.media.count({ where: { memory: { familyId: family.id } } }),
    prisma.collection.count({ where: { familyId: family.id, parentId: null } }),
  ]);

  const members = memberships.map((m) => ({
      userId: m.userId,
      role: m.role,
      permission: ROLE_LABELS[m.role],
      name: m.person?.name ?? m.user.displayName,
      // Addresses are for whoever manages membership, and your own.
      email: isOwner || m.userId === user.id ? m.user.email : null,
      isYou: m.userId === user.id,
      person: m.person ? personDto(m.person) : null,
      joinedAt: m.createdAt.toISOString(),
    }));

  const others = people
    .filter((p) => p.membership === null)
    .map((p) => ({
      ...personDto(p),
      invitable: p.role !== "CHILD" && p.userId === null,
    }));

  res.json({
    family: {
      id: family.id,
      name: family.name,
      createdAt: family.createdAt.toISOString(),
    },
    role,
    members,
    people: others,
    stats: { memoryCount, mediaCount, collectionCount, personCount: people.length },
    subscription: { plan: "little by little Family (preview)", status: "Not billed in this build" },
  });
});

const newInvite = z
  .object({
    role: z.enum(["OWNER", "CONTRIBUTOR", "VIEWER"]).default("CONTRIBUTOR"),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    personId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => !(v.personId && v.name), { message: "Give personId or name, not both" });

familyRouter.post("/family/invites", requireOwner, async (req, res) => {
  const { family, user } = req.ctx;
  const parsed = newInvite.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { role, email, personId, name } = parsed.data;

  if (personId) {
    const person = await prisma.person.findFirst({
      where: { id: personId, familyId: family.id },
      include: { membership: { select: { userId: true } } },
    });
    if (!person) return res.status(400).json({ error: "unknown_reference" });
    if (person.role === "CHILD") return res.status(400).json({ error: "child_person" });
    if (person.membership || person.userId) return res.status(409).json({ error: "person_linked" });
  }

  const invite = await prisma.invite.create({
    data: {
      familyId: family.id,
      role,
      email: email ?? null,
      personId: personId ?? null,
      name: name ?? null,
      token: newInviteToken(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedById: user.id,
    },
    include: { person: true },
  });
  const dto = inviteDto(req, invite);

  let emailed = false;
  if (email) {
    try {
      await emailSender().send(
        inviteEmail({
          to: email,
          familyName: family.name,
          inviterName: await memberName(user.id, family.id),
          forName: dto.forName,
          role,
          url: dto.url,
        }),
      );
      emailed = emailSender().delivers;
    } catch (err) {
      req.log.error({ err: errorMessage(err), inviteId: invite.id }, "invite email failed to send");
    }
  }

  res.status(201).json({ invite: dto, emailed });
});

familyRouter.get("/family/invites", requireOwner, async (req, res) => {
  const invites = await prisma.invite.findMany({
    where: { familyId: req.ctx.family.id, ...pendingInviteWhere() },
    include: { person: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ invites: invites.map((i) => inviteDto(req, i)) });
});

familyRouter.delete("/family/invites/:id", requireOwner, async (req, res) => {
  const { family } = req.ctx;
  const { count } = await prisma.invite.updateMany({
    where: { id: req.params.id, familyId: family.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 1) return res.status(204).end();

  const invite = await prisma.invite.findFirst({ where: { id: req.params.id, familyId: family.id } });
  if (!invite) return res.status(404).json({ error: "not_found" });
  res.status(409).json({ error: inviteStatus(invite) });
});

class MembershipRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

// The family row lock stops two owners demoting or removing each other at once and leaving none.
async function withMembershipLock<T>(familyId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${familyId} FOR UPDATE`;
    return work(tx);
  });
}

async function refuseLastOwner(tx: Prisma.TransactionClient, familyId: string) {
  const owners = await tx.familyMembership.count({ where: { familyId, role: "OWNER" } });
  if (owners <= 1) throw new MembershipRefusal(409, "last_owner");
}

const rolePatch = z.object({ role: z.enum(["OWNER", "CONTRIBUTOR", "VIEWER"]) });

familyRouter.patch("/family/members/:userId", requireOwner, async (req, res) => {
  const { family } = req.ctx;
  const parsed = rolePatch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { role } = parsed.data;

  try {
    await withMembershipLock(family.id, async (tx) => {
      const target = await tx.familyMembership.findUnique({
        where: { userId_familyId: { userId: req.params.userId, familyId: family.id } },
      });
      if (!target) throw new MembershipRefusal(404, "not_found");
      if (target.role === role) return;
      if (target.role === "OWNER") await refuseLastOwner(tx, family.id);
      await tx.familyMembership.update({
        where: { userId_familyId: { userId: target.userId, familyId: family.id } },
        data: { role },
      });
    });
  } catch (err) {
    if (err instanceof MembershipRefusal) return res.status(err.status).json({ error: err.code });
    throw err;
  }
  res.json({ member: { userId: req.params.userId, role, permission: ROLE_LABELS[role] } });
});

familyRouter.delete("/family/members/:userId", requireOwner, async (req, res) => {
  const { family } = req.ctx;
  try {
    await withMembershipLock(family.id, async (tx) => {
      const target = await tx.familyMembership.findUnique({
        where: { userId_familyId: { userId: req.params.userId, familyId: family.id } },
      });
      if (!target) throw new MembershipRefusal(404, "not_found");
      if (target.role === "OWNER") await refuseLastOwner(tx, family.id);

      await tx.familyMembership.delete({
        where: { userId_familyId: { userId: target.userId, familyId: family.id } },
      });
      if (target.personId) {
        await tx.person.updateMany({
          where: { id: target.personId, userId: target.userId },
          data: { userId: null },
        });
      }
    });
  } catch (err) {
    if (err instanceof MembershipRefusal) return res.status(err.status).json({ error: err.code });
    throw err;
  }
  req.log.info({ familyId: family.id, removed: req.params.userId, by: req.ctx.user.id }, "member removed");
  res.status(204).end();
});

familyRouter.delete("/family", requireOwner, async (req, res) => {
  const { family, user } = req.ctx;
  const deleted = await deleteFamily(jobQueue(), family.id);
  if (!deleted) return res.status(404).json({ error: "not_found" });
  req.log.info({ familyId: family.id, by: user.id }, "family deleted");
  res.status(204).end();
});
