import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Prisma, type MembershipRole, type User } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { AUTH_MODE } from "./index.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

// Dev mode only: a tokenless request acts as this user. Never read in firebase mode.
const DEV_DEFAULT_USER = process.env.DEV_DEFAULT_USER;

function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (header) {
    const [scheme, ...rest] = header.split(" ");
    if (scheme.toLowerCase() !== "bearer") return null;
    const token = rest.join(" ").trim();
    return token.length > 0 ? token : null;
  }
  if (AUTH_MODE === "dev" && DEV_DEFAULT_USER) return `dev:${DEV_DEFAULT_USER}`;
  return null;
}

export type AccountConflict = "verify_email" | "email_in_use";

export type ResolvedUser = { user: User } | { conflict: AccountConflict };

// The one takeover allowed is of a `dev:` account by a verified address; anything else
// sharing the email is a conflict, never a silent merge.
export async function resolveUser(identity: VerifiedIdentity, attempt = 0): Promise<ResolvedUser> {
  const known = await prisma.user.findUnique({ where: { authProviderId: identity.providerId } });
  if (known) return { user: known };

  const sameEmail = await prisma.user.findFirst({
    where: { email: { equals: identity.email, mode: "insensitive" } },
  });

  if (sameEmail) {
    // A concurrent first request created our own row between the two reads.
    if (sameEmail.authProviderId === identity.providerId) return { user: sameEmail };
    const isDevAccount = sameEmail.authProviderId.startsWith("dev:");
    if (!isDevAccount) return { conflict: "email_in_use" };
    if (!identity.emailVerified) return { conflict: "verify_email" };

    // Conditional on the row still being the dev account, so two first
    // requests racing here rebind it once and the loser re-resolves.
    const { count } = await prisma.user.updateMany({
      where: { id: sameEmail.id, authProviderId: sameEmail.authProviderId },
      data: { authProviderId: identity.providerId },
    });
    if (count === 1) {
      logger.info(
        { userId: sameEmail.id, from: sameEmail.authProviderId, to: identity.providerId },
        "auth: dev account taken over by verified provider identity",
      );
      return { user: { ...sameEmail, authProviderId: identity.providerId } };
    }
    return attempt === 0 ? resolveUser(identity, 1) : { conflict: "email_in_use" };
  }

  try {
    const user = await prisma.user.create({
      data: {
        authProviderId: identity.providerId,
        email: identity.email,
        displayName: identity.displayName,
      },
    });
    return { user };
  } catch (err) {
    // Two first requests from the same new account can race the create; one more pass finds the row.
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (isUniqueViolation && attempt === 0) return resolveUser(identity, 1);
    throw err;
  }
}

// 401 never says why a token failed. 503 when the provider is unreachable: a 401 would
// sign the client out over someone else's outage.
export function requireUser(verifier: TokenVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = bearerFrom(req);
    if (!bearer) return res.status(401).json({ error: "unauthorized" });

    let identity: VerifiedIdentity | null;
    try {
      identity = await verifier.verify(bearer);
    } catch (err) {
      (req.log ?? logger).error({ err }, "token verification unavailable");
      return res.status(503).json({ error: "auth_unavailable" });
    }
    if (!identity) return res.status(401).json({ error: "unauthorized" });

    try {
      const resolved = await resolveUser(identity);
      if ("conflict" in resolved) {
        const status = resolved.conflict === "verify_email" ? 403 : 409;
        return res.status(status).json({ error: resolved.conflict });
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- half-built until requireFamily runs
      req.ctx = { user: resolved.user, emailVerified: identity.emailVerified } as Request["ctx"];
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireFamily: RequestHandler = async (req, res, next) => {
  try {
    const memberships = await prisma.familyMembership.findMany({
      where: { userId: req.ctx.user.id },
      include: { family: true },
      orderBy: { createdAt: "asc" },
    });

    const header = req.headers["x-family-id"];
    const requested = (Array.isArray(header) ? header[0] : header)?.trim();

    if (requested) {
      const membership = memberships.find((m) => m.familyId === requested);
      if (!membership) return res.status(403).json({ error: "forbidden" });
      req.ctx.family = membership.family;
      req.ctx.role = membership.role;
      return next();
    }

    if (memberships.length === 0) return res.status(404).json({ error: "no_family" });

    if (memberships.length > 1) {
      return res.status(400).json({
        error: "family_required",
        families: memberships.map((m) => ({
          id: m.familyId,
          name: m.family.name,
          role: m.role,
        })),
      });
    }

    req.ctx.family = memberships[0].family;
    req.ctx.role = memberships[0].role;
    next();
  } catch (err) {
    next(err);
  }
};

// Generic in the params so that, between a path and its handler, it doesn't stand in
// for the path when TypeScript infers `req.params`.
export function requireRole(...roles: MembershipRole[]) {
  return <P>(req: Request<P>, res: Response, next: NextFunction) => {
    if (roles.includes(req.ctx.role)) return next();
    res.status(403).json({ error: "forbidden_role", role: req.ctx.role, required: roles });
  };
}

export const requireContributor = requireRole("OWNER", "CONTRIBUTOR");

export const requireOwner = requireRole("OWNER");
