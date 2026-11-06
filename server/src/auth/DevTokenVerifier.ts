import { displayNameFromEmail } from "./display-name.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

const UNVERIFIED_PREFIX = "dev-unverified:";

// Not authentication: the token is the claim. createTokenVerifier() refuses
// this in production unless explicitly opted in.
export class DevTokenVerifier implements TokenVerifier {
  async verify(bearer: string): Promise<VerifiedIdentity | null> {
    const token = bearer.trim();
    const verified = token.startsWith("dev:");
    if (!verified && !token.startsWith(UNVERIFIED_PREFIX)) return null;

    const email = token
      .slice((verified ? "dev:" : UNVERIFIED_PREFIX).length)
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

    return {
      providerId: `dev:${email}`,
      email,
      displayName: displayNameFromEmail(email),
      emailVerified: verified,
    };
  }
}
