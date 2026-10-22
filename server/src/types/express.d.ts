import type { Family, MembershipRole, User } from "@prisma/client";

/**
 * Who is asking, and which family they are asking about.
 *
 * `user` and `emailVerified` are set by `requireUser`; `family` and `role` by `requireFamily`.
 * Both are declared non-optional because every route that reads them is
 * mounted behind the middleware that sets them (see the mount order in
 * `index.ts`) — the alternative is an optional-chain on every query, which
 * makes the one thing that must never be forgotten the easiest thing to skip.
 */
export interface RequestContext {
  user: User;
  /**
   * The provider has verified `user.email` — read from this request's token,
   * not stored, so it flips the moment the client refreshes its token after
   * verifying. A4's invite accept must require it.
   */
  emailVerified: boolean;
  family: Family;
  role: MembershipRole;
}

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}
