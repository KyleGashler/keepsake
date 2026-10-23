import { Prisma, type Person } from "@prisma/client";
import { Router } from "express";
import { inviteStatus, plausibleToken } from "../lib/invites.js";
import { prisma } from "../lib/prisma.js";

/**
 * The invitee's side of an invite: look at it, then accept it. Neither is
 * scoped to a family the caller belongs to — the whole point is that they
 * don't yet — so neither sits behind `requireFamily`. The owner's side
 * (create, list, revoke) is in family.ts.
 */

/** How someone appears inside one family: their Person there, else their account name. */
export async function memberName(userId: string, familyId: string) {
  const membership = await prisma.familyMembership.findUnique({
    where: { userId_familyId: { userId, familyId } },
    include: { person: { select: { name: true } }, user: { select: { displayName: true } } },
  });
  if (membership) return membership.person?.name ?? membership.user.displayName;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName ?? "Someone";
}

/**
 * `GET /api/invites/:token` — mounted *before* `requireUser`, so it answers
 * without a token.
 *
 * Public on purpose: the person following an invite link is usually signed
 * out, often without an account at all, and should see who is inviting them
 * to what before being asked to sign up. The token is the credential — 256
 * random bits, so it can't be found by guessing — and whoever holds it is
 * exactly who the owner chose to show this to. Even so, the answer is the
 * minimum the join screen needs: the family's name, the inviter's name, the
 * role, the name the invite is for, and whether it still works. No ids, no
 * email address, nothing from inside the archive.
 */
export const invitePreviewRouter = Router();

invitePreviewRouter.get("/invites/:token", async (req, res) => {
  const { token } = req.params;
  if (!plausibleToken(token)) return res.status(404).json({ error: "not_found" });

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { family: { select: { name: true } }, person: { select: { name: true } } },
  });
  if (!invite) return res.status(404).json({ error: "not_found" });

  res.json({
    invite: {
      familyName: invite.family.name,
      inviterName: await memberName(invite.invitedById, invite.familyId),
      role: invite.role,
      forName: invite.person?.name ?? invite.name,
      status: inviteStatus(invite),
      expiresAt: invite.expiresAt.toISOString(),
    },
  });
});

/** Why an accept was turned down, thrown inside the transaction so nothing it did sticks. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/**
 * `POST /api/invites/:token/accept` — behind `requireUser` only.
 *
 * Needs a verified email (B1's rule: the address is the one thing an invite
 * link can be forwarded away from, so whoever joins must at least have proven
 * an inbox). The invite isn't bound to any address — any verified account may
 * take it — and it works once: the claim is a conditional update, so two
 * accepts racing for one link can't both win.
 */
export const inviteAcceptRouter = Router();

inviteAcceptRouter.post("/invites/:token/accept", async (req, res) => {
  const { user, emailVerified } = req.ctx;
  if (!emailVerified) return res.status(403).json({ error: "verify_email" });

  const { token } = req.params;
  if (!plausibleToken(token)) return res.status(404).json({ error: "not_found" });
  const invite = await prisma.invite.findUnique({ where: { token }, include: { family: true } });
  if (!invite) return res.status(404).json({ error: "not_found" });

  const status = inviteStatus(invite);
  if (status !== "valid") return res.status(410).json({ error: status });

  const alreadyMember = async () =>
    prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: user.id, familyId: invite.familyId } },
      select: { userId: true },
    });
  if (await alreadyMember()) {
    return res.status(409).json({ error: "already_member", familyId: invite.familyId });
  }

  // See POST /families: Person.userId is a global back-link, held by at most
  // one Person; FamilyMembership.personId is the per-family link.
  const alreadyLinked = await prisma.person.findUnique({ where: { userId: user.id }, select: { id: true } });

  let person: Person;
  try {
    person = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now, acceptedById: user.id },
      });
      if (claimed.count !== 1) {
        const current = await tx.invite.findUniqueOrThrow({ where: { id: invite.id } });
        throw new Refusal(410, inviteStatus(current, now));
      }

      let joined: Person;
      if (invite.personId) {
        const named = await tx.person.findFirst({
          where: { id: invite.personId, familyId: invite.familyId },
          include: { membership: { select: { userId: true } } },
        });
        // Linked to someone else since the invite was made (another invite
        // for the same Person got there first). Children never get accounts.
        const taken = !named || named.membership !== null || (named.userId !== null && named.userId !== user.id);
        if (taken || named.role === "CHILD") throw new Refusal(409, "person_taken");
        joined =
          named.userId === null && !alreadyLinked
            ? await tx.person.update({ where: { id: named.id }, data: { userId: user.id } })
            : named;
      } else {
        const max = await tx.person.aggregate({ where: { familyId: invite.familyId }, _max: { sortOrder: true } });
        joined = await tx.person.create({
          data: {
            familyId: invite.familyId,
            name: invite.name ?? user.displayName,
            role: "RELATIVE",
            relation: null,
            avatarSeed: `person-${invite.id}`,
            userId: alreadyLinked ? null : user.id,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
          },
        });
      }

      await tx.familyMembership.create({
        data: { userId: user.id, familyId: invite.familyId, role: invite.role, personId: joined.id },
      });

      await tx.activityEvent.create({
        data: {
          familyId: invite.familyId,
          actorId: joined.id,
          kind: "member_joined",
          message: `${joined.name} joined the archive.`,
        },
      });

      return joined;
    });
  } catch (err) {
    if (err instanceof Refusal) return res.status(err.status).json({ error: err.code });
    // A unique constraint lost to a concurrent request: this user joined the
    // family another way a moment ago, or someone else claimed the Person.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      if (await alreadyMember()) {
        return res.status(409).json({ error: "already_member", familyId: invite.familyId });
      }
      return res.status(409).json({ error: "person_taken" });
    }
    throw err;
  }

  req.log.info({ inviteId: invite.id, familyId: invite.familyId, userId: user.id }, "invite accepted");
  res.json({
    membership: {
      familyId: invite.familyId,
      familyName: invite.family.name,
      role: invite.role,
      personId: person.id,
    },
  });
});
