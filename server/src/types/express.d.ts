import type { Family, MembershipRole, User } from "@prisma/client";

// Non-optional because every route that reads these is mounted behind the middleware that
// sets them; an optional chain on every query would make the check easy to skip.
export interface RequestContext {
  user: User;
  // From this request's token, not stored, so it flips as soon as the client refreshes it.
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
