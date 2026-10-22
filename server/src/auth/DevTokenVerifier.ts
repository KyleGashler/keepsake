import { displayNameFromEmail } from "./display-name.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

/**
 * Development identity: the token *is* the claim. `Bearer dev:ali@example.com`
 * signs you in as ali@example.com, no password and no signature.
 *
 * That is obviously not authentication — it is a stand-in that keeps local
 * development, the seeded demo family and curl smoke tests working without a
 * Firebase project. `createTokenVerifier()` refuses to hand this out in
 * production unless someone opts in loudly.
 */
export class DevTokenVerifier implements TokenVerifier {
  async verify(bearer: string): Promise<VerifiedIdentity | null> {
    const token = bearer.trim();
    if (!token.startsWith("dev:")) return null;

    const email = token.slice("dev:".length).trim().toLowerCase();
    // Not RFC 5322 — just enough to reject "dev:" and "dev:not an email".
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

    // There is no inbox to prove, so a dev identity counts as verified.
    return {
      providerId: `dev:${email}`,
      email,
      displayName: displayNameFromEmail(email),
      emailVerified: true,
    };
  }
}
