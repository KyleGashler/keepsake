import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Prisma, type User } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { AUTH_MODE } from "./index.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

/**
 * Dev mode only: a request with no Authorization header at all is treated as
 * `Bearer dev:<DEV_DEFAULT_USER>`. The app always sends a token now (A8); this
 * survives so `curl localhost:4000/api/home` works against compose without
 * one. Unset the variable and the API behaves like production: no token, no
 * access. Never read in firebase mode.
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
 * Why an identity the provider vouched for still can't be let in:
 *
 * - `verify_email` — the address already belongs to a dev-era account, and only
 *   a verified address may take it over. Verifying fixes it; the client shows
 *   its verify-email state.
 * - `email_in_use` — the address belongs to a different real account (another
 *   Firebase uid, e.g. one deleted and re-created). Nothing the person can do
 *   in the app fixes that.
 */
export type AccountConflict = "verify_email" | "email_in_use";

export type ResolvedUser = { user: User } | { conflict: AccountConflict };

/**
 * Mirror the provider's identity into a local `User`. Email and display name
 * are recorded the first time we see the account and left alone afterwards —
 * the provider is the source of truth for identity, but the archive is the
 * source of truth for how a person appears in it.
 *
 * `User.email` is unique as well as `authProviderId`, so a new provider
 * identity can meet an existing row by email. The one takeover allowed is of a
 * `dev:` account by a verified address: that is how the families created
 * under dev auth (the hosted demo among them) pass to the real account with
 * the same email. Anything else is a conflict, never a silent merge.
 */
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
    // Lost the race: the row moved under us. Look again, once.
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
    // Two first requests from the same new account can race the create. The
    // loser sees a unique-constraint violation; one more pass finds the row.
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (isUniqueViolation && attempt === 0) return resolveUser(identity, 1);
    throw err;
  }
}

/**
 * Resolve the caller. 401 for a missing, malformed, or unverifiable token —
 * the response never says which, because that difference is only useful to
 * someone guessing. 503 when the verifier couldn't decide (its provider is
 * unreachable): a 401 would sign the client out over someone else's outage.
 */
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
      // `family` and `role` land in `requireFamily`, one middleware later.
      // See the note on RequestContext in src/types/express.d.ts.
      // oxlint-disable-next-line typescript/consistent-type-assertions -- half-built until requireFamily runs
      req.ctx = { user: resolved.user, emailVerified: identity.emailVerified } as Request["ctx"];
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
