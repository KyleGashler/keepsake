/**
 * The one seam between little by little and whoever vouches for a person's identity.
 *
 * Everything above this line — middleware, routes, family scoping — only ever
 * sees the fields below. `createTokenVerifier()` picks the implementation
 * (`DevTokenVerifier` or `FirebaseTokenVerifier`); nothing else knows which.
 */
export interface VerifiedIdentity {
  /** Stable provider subject, mirrored onto `User.authProviderId`. */
  providerId: string;
  /** Lower-cased. Every identity has one; a token without an email is refused. */
  email: string;
  displayName: string;
  /**
   * The provider has seen the person follow a link sent to `email`. Not needed
   * to use the app; needed to accept an invite (A4) and to take over an
   * existing dev account with the same address (see `resolveUser`).
   */
  emailVerified: boolean;
}

export interface TokenVerifier {
  /**
   * Resolve the raw credential from `Authorization: Bearer <token>`.
   * Returns null for anything it can't vouch for — never throws for a bad
   * token, so a malformed header is a 401 rather than a 500. It may throw when
   * it can't decide at all (the provider's signing keys are unreachable); the
   * middleware answers that with a 503, so a client doesn't sign out over an
   * outage that isn't its fault.
   */
  verify: (bearer: string) => Promise<VerifiedIdentity | null>;
}
