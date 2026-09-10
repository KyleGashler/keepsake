import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

/**
 * Development identity: the token *is* the claim. `Bearer dev:ali@example.com`
 * signs you in as ali@example.com, no password and no signature.
 *
 * That is obviously not authentication — it is a stand-in that lets the whole
 * request-context and family-scoping machinery be built and exercised before
 * Firebase exists (B1). `createTokenVerifier()` refuses to hand this out in
 * production unless someone opts in loudly.
 */
export class DevTokenVerifier implements TokenVerifier {
  async verify(bearer: string): Promise<VerifiedIdentity | null> {
    const token = bearer.trim();
    if (!token.startsWith("dev:")) return null;

    const email = token.slice("dev:".length).trim().toLowerCase();
    // Not RFC 5322 — just enough to reject "dev:" and "dev:not an email".
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

    return { providerId: `dev:${email}`, email, displayName: displayNameFor(email) };
  }
}

/** "ali.reyes@example.com" → "Ali Reyes", so the seeded UI has a name to show. */
function displayNameFor(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1));
  return words.length ? words.join(" ") : localPart;
}
