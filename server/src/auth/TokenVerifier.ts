/**
 * The one seam between Keepsake and whoever vouches for a person's identity.
 *
 * Everything above this line — middleware, routes, family scoping — only ever
 * sees the three fields below. Swapping `DevTokenVerifier` for a Firebase one
 * (B1) is a change to `createTokenVerifier()` and nothing else.
 */
export interface VerifiedIdentity {
  /** Stable provider subject, mirrored onto `User.authProviderId`. */
  providerId: string;
  email: string;
  displayName: string;
}

export interface TokenVerifier {
  /**
   * Resolve the raw credential from `Authorization: Bearer <token>`.
   * Returns null for anything it can't vouch for — never throws for a bad
   * token, so a malformed header is a 401 rather than a 500.
   */
  verify: (bearer: string) => Promise<VerifiedIdentity | null>;
}
