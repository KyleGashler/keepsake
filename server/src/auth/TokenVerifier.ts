export interface VerifiedIdentity {
  providerId: string;
  /** Lower-cased. */
  email: string;
  displayName: string;
  /** Required to accept an invite and to take over an existing dev account with the same address. */
  emailVerified: boolean;
}

export interface TokenVerifier {
  // Returns null for a bad token (401). Throws only when it can't decide, e.g. signing keys unreachable,
  // which the middleware answers with 503 so a client doesn't sign out over an outage.
  verify: (bearer: string) => Promise<VerifiedIdentity | null>;
}
