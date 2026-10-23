import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import { emailSender } from "../email/index.js";
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

/**
 * Family Hub: administrative rather than emotional, hence its own modal.
 *
 * `members` are the accounts in the family (FamilyMembership), each with the
 * role that decides what they can do. `people` are everyone else in the
 * archive — children, and adults who haven't joined — with whether an invite
 * can name them. `role` is the caller's own, so the client can leave out what
 * it would only be refused.
 */
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
    prisma.memory.count({ where: { familyId: family.id, deletedAt: null } }),
    prisma.media.count({ where: { deletedAt: null, memory: { familyId: family.id, deletedAt: null } } }),
    prisma.collection.count({ where: { familyId: family.id } }),
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
      // Children are Person rows and never accounts; anyone else without one
      // can be named by an invite.
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
    /** Also email the link here. Optional: the link is shared by hand either way. */
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    /** An existing Person in this family the invite is for: unlinked and not a child. */
    personId: z.string().min(1).optional(),
    /** For someone not in the archive yet: what to call the Person accept creates. */
    name: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => !(v.personId && v.name), { message: "Give personId or name, not both" });

/**
 * Make an invite link. Single use, a week long, revocable. With an email it
 * is also sent there (EmailSender — the log until B6); a send that fails
 * still leaves a working link to share by hand. `emailed` says whether it is
 * on its way to an inbox — false for a failed send and for the console sender.
 */
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
      // Only true if it can reach an inbox: the console sender just logs it.
      emailed = emailSender().delivers;
    } catch (err) {
      req.log.error({ err: errorMessage(err), inviteId: invite.id }, "invite email failed to send");
    }
  }

  res.status(201).json({ invite: dto, emailed });
});

/** Pending invites, newest first. Used, revoked and expired ones drop off. */
familyRouter.get("/family/invites", requireOwner, async (req, res) => {
  const invites = await prisma.invite.findMany({
    where: { familyId: req.ctx.family.id, ...pendingInviteWhere() },
    include: { person: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ invites: invites.map((i) => inviteDto(req, i)) });
});

/** Revoke: the link stops working at once. One already used can't be taken back here — remove the member. */
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

/** Thrown inside a membership transaction to refuse and roll back. */
class MembershipRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * Run a change to who's in the family with the family row locked, so two
 * owners demoting or removing each other at once can't leave it with none:
 * the second waits for the first, then counts again.
 */
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

/** Change what a member can do. The last owner can't be demoted. */
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

/**
 * Take someone out of the family. Their Person stays — memories they wrote or
 * appear in are the family's — but it no longer signs in. The last owner can't
 * be removed (by anyone, themselves included); an owner may remove themselves
 * when another owner remains.
 */
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
      // The global back-link, if it points at this family's Person.
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
