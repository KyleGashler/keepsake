import { Prisma } from "@prisma/client";
import type { JobQueue } from "../jobs/JobQueue.js";
import { prisma } from "./prisma.js";
import { deleteFamilyAndPurge } from "./purge.js";

/**
 * Deleting a family, and deleting an account (A16).
 *
 * Decided 2026-10-23 (docs/PLAN.md, A16): an owner deleting a family deletes
 * it for everyone — every member, every memory, every file, with no trash
 * and no restore. Only an owner of at least one family may delete their
 * account; doing so deletes every family they own (even ones with other
 * owners), leaves every family where they're a contributor or viewer (as
 * `DELETE /family/members/:userId` would: membership gone, their Person
 * stays, unlinked), and deletes the User row.
 *
 * The provider identity (Firebase) is not the server's to delete — it holds
 * no service account. The client deletes it after `DELETE /api/me` answers.
 */

export type DeletionPreview = {
  /** False when they own no family: only an owner can delete their account. */
  allowed: boolean;
  reason?: "not_an_owner";
  /** Families deleted outright, for everyone in them. */
  deletes: { familyId: string; name: string; members: number; memories: number }[];
  /** Families they'd only leave. */
  leaves: { familyId: string; name: string }[];
};

export async function deletionPreview(userId: string): Promise<DeletionPreview> {
  const memberships = await prisma.familyMembership.findMany({
    where: { userId },
    include: {
      family: { select: { id: true, name: true, _count: { select: { memberships: true, memories: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const owned = memberships.filter((m) => m.role === "OWNER");
  return {
    allowed: owned.length > 0,
    ...(owned.length ? {} : { reason: "not_an_owner" as const }),
    deletes: owned.map((m) => ({
      familyId: m.familyId,
      name: m.family.name,
      members: m.family._count.memberships,
      memories: m.family._count.memories,
    })),
    leaves: memberships
      .filter((m) => m.role !== "OWNER")
      .map((m) => ({ familyId: m.familyId, name: m.family.name })),
  };
}

/** A long transaction: a family with years of memories cascades a lot of rows. */
const DELETE_TX = { maxWait: 10_000, timeout: 120_000 } as const;

/**
 * Delete one family for everyone. The caller has checked they own it.
 * False when it was already gone.
 */
export async function deleteFamily(queue: JobQueue, familyId: string): Promise<boolean> {
  return retryOnDeadlock(() =>
    prisma.$transaction((tx) => deleteFamilyAndPurge(tx, queue, { familyId, reason: "family" }), DELETE_TX),
  );
}

export type AccountDeletion =
  | { ok: true; deleted: string[]; left: string[] }
  | { ok: false; reason: "not_an_owner" | "gone" };

/**
 * Delete the account: owned families deleted, the rest left, the User row
 * gone. All or nothing, in one transaction.
 *
 * Lock order: the User row first (so no membership, invite or favourite can
 * be added for them meanwhile — each insert would need a key-share lock on
 * it), then each owned family (see deleteFamilyAndPurge), then each family
 * they leave, both in id order.
 */
export async function deleteAccount(queue: JobQueue, userId: string): Promise<AccountDeletion> {
  return retryOnDeadlock(() =>
    prisma.$transaction(async (tx): Promise<AccountDeletion> => {
      const user = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (user.length === 0) return { ok: false, reason: "gone" };

      const memberships = await tx.familyMembership.findMany({ where: { userId }, orderBy: { familyId: "asc" } });
      const owned = memberships.filter((m) => m.role === "OWNER").map((m) => m.familyId);
      if (owned.length === 0) return { ok: false, reason: "not_an_owner" };

      const deleted: string[] = [];
      for (const familyId of owned) {
        if (await deleteFamilyAndPurge(tx, queue, { familyId, reason: "account" })) deleted.push(familyId);
      }

      const left: string[] = [];
      for (const m of memberships.filter((x) => x.role !== "OWNER")) {
        await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${m.familyId} FOR UPDATE`;
        // Read again under the family's lock: an owner may have changed or
        // removed the membership while we waited.
        const current = await tx.familyMembership.findUnique({
          where: { userId_familyId: { userId, familyId: m.familyId } },
        });
        if (!current) continue;
        await tx.familyMembership.delete({ where: { userId_familyId: { userId, familyId: m.familyId } } });
        // Their Person stays — memories they wrote or appear in are the
        // family's — but no longer signs in. (The User delete below would
        // null it too; done here so leaving reads the same as being removed.)
        if (current.personId) {
          await tx.person.updateMany({ where: { id: current.personId, userId }, data: { userId: null } });
        }
        left.push(m.familyId);
      }

      // What's left cascades or unlinks with the row (schema.prisma): device
      // tokens, favourites and invites they sent go; invites they accepted
      // and any Person still linked keep their row with the link nulled.
      await tx.user.delete({ where: { id: userId } });
      return { ok: true, deleted, left };
    }, DELETE_TX),
  );
}

/**
 * Two deletes, or a delete and an insert, can each hold a lock the other
 * needs (see the lock orders above); Postgres aborts one. That one is safe to
 * run again from the top.
 */
async function retryOnDeadlock<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await work();
    } catch (err) {
      if (i >= attempts || !isDeadlock(err)) throw err;
    }
  }
}

function isDeadlock(err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return true;
    // A raw query reports the database's own code.
    if (err.code === "P2010" && /40P01|40001/.test(JSON.stringify(err.meta ?? {}))) return true;
  }
  return err instanceof Error && /deadlock detected/i.test(err.message);
}
