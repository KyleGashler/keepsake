import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { User } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { AUTH_MODE } from "./index.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

/**
 * The bridge that keeps the current app working. Until A8 the client sends no
 * Authorization header at all, so in dev mode an unauthenticated request is
 * treated as `Bearer dev:<DEV_DEFAULT_USER>`. Unset the variable and the API
 * behaves like production: no token, no access.
 */
const DEV_DEFAULT_USER = process.env.DEV_DEFAULT_USER;

/** `Authorization: Bearer <token>` → `<token>`. Anything else → null. */
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

/**
 * Mirror the provider's identity into a local `User`. Email and display name
 * are recorded the first time we see the account and left alone afterwards —
 * the provider is the source of truth for identity, but the archive is the
 * source of truth for how a person appears in it.
 */
async function upsertUser(identity: VerifiedIdentity): Promise<User> {
  const create = {
    authProviderId: identity.providerId,
    email: identity.email,
    displayName: identity.displayName,
  };
  try {
    return await prisma.user.upsert({
      where: { authProviderId: identity.providerId },
      update: {},
      create,
    });
  } catch (err) {
    // Two first requests from the same new account can race the create. The
    // loser sees a unique-constraint violation; the row it wanted now exists.
    const existing = await prisma.user.findUnique({
      where: { authProviderId: identity.providerId },
    });
    if (existing) return existing;
    throw err;
  }
}

/**
 * Resolve the caller. 401 for a missing, malformed, or unverifiable token —
 * the response never says which, because that difference is only useful to
 * someone guessing.
 */
export function requireUser(verifier: TokenVerifier): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bearer = bearerFrom(req);
    if (!bearer) return res.status(401).json({ error: "unauthorized" });

    let identity: VerifiedIdentity | null;
    try {
      identity = await verifier.verify(bearer);
    } catch (err) {
      (req.log ?? logger).warn({ err }, "token verification threw");
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!identity) return res.status(401).json({ error: "unauthorized" });

    try {
      const user = await upsertUser(identity);
      // Cast: `family` and `role` land in `requireFamily`, one middleware
      // later. See the note on RequestContext in src/types/express.d.ts.
      req.ctx = { user } as Request["ctx"];
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Choose the family this request is about, and prove the caller belongs to it.
 *
 * `x-family-id` is explicit and wins; without it a single membership is
 * unambiguous, several are not, and none means there is nothing to look at yet.
 */
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
      // Deliberately 403 and not 404: the caller named a specific family, and
      // pretending it doesn't exist would only make them retry.
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
