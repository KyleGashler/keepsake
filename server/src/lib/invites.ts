import crypto from "node:crypto";
import type { Request } from "express";
import type { Invite, MembershipRole, Person, Prisma } from "@prisma/client";
import type { EmailMessage } from "../email/index.js";

/** An invite link works for a week, once. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 256 random bits, URL-safe: the link is the credential, so it must not be guessable. */
export function newInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/** Anything that couldn't be a token from `newInviteToken` — answered 404 without a query. */
export function plausibleToken(token: string) {
  return /^[A-Za-z0-9_-]{20,128}$/.test(token);
}

export type InviteStatus = "valid" | "expired" | "used" | "revoked";

export function inviteStatus(invite: Pick<Invite, "acceptedAt" | "revokedAt" | "expiresAt">, now = new Date()): InviteStatus {
  if (invite.acceptedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  return "valid";
}

/** Not accepted, not revoked, not expired. */
export function pendingInviteWhere(now = new Date()) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } satisfies Prisma.InviteWhereInput;
}

/** How a membership role reads in the app; the client keeps the same words. */
export const ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: "Owner",
  CONTRIBUTOR: "Can add memories",
  VIEWER: "Can view",
};

const DEV_APP_URL = "http://localhost:8081";

/**
 * Where the app lives, for links that leave the API (invite links today).
 * `APP_URL` when set. Otherwise production serves the web bundle from this
 * same origin (see WEB_DIR in index.ts), so the request's own origin is the
 * app's; locally the app is Metro on :8081.
 */
export function appUrl(req: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") return `${req.protocol}://${req.get("host")}`;
  return DEV_APP_URL;
}

export function joinUrl(req: Request, token: string) {
  return `${appUrl(req)}/join/${token}`;
}

type InviteRow = Invite & { person: Person | null };

/** An invite as the owner's Family Hub sees it — including the link, so it can be copied again. */
export function inviteDto(req: Request, invite: InviteRow) {
  return {
    id: invite.id,
    role: invite.role,
    email: invite.email,
    personId: invite.personId,
    /** Who it's for: the named Person, the name typed for someone new, or null. */
    forName: invite.person?.name ?? invite.name,
    status: inviteStatus(invite),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
    url: joinUrl(req, invite.token),
  };
}

const INVITE_PURPOSE: Record<MembershipRole, string> = {
  OWNER: "to keep the family's memories together with them",
  CONTRIBUTOR: "to look through the family's memories and add your own",
  VIEWER: "to look through the family's memories",
};

/** The email that goes with an invite when the owner gives an address. */
export function inviteEmail({
  to,
  familyName,
  inviterName,
  forName,
  role,
  url,
}: {
  to: string;
  familyName: string;
  inviterName: string;
  forName: string | null;
  role: MembershipRole;
  url: string;
}): EmailMessage {
  const greeting = forName ? `Hi ${forName},` : "Hello,";
  const what = INVITE_PURPOSE[role];
  return {
    to,
    subject: `${inviterName} invited you to “${familyName}” on little by little`,
    text: [
      greeting,
      "",
      `${inviterName} has invited you to join “${familyName}” on little by little, ${what}.`,
      "",
      `Join here: ${url}`,
      "",
      "The link works once and expires in 7 days. If you weren't expecting this, you can ignore it.",
    ].join("\n"),
  };
}
