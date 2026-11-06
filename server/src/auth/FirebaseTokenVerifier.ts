import { initializeApp, type App } from "firebase-admin/app";
import { FirebaseAuthError, getAuth, type Auth } from "firebase-admin/auth";
import { logger } from "../lib/logger.js";
import { displayNameFromEmail } from "./display-name.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

// Verifying an ID token needs no credentials (Google's public certs plus the project id);
// a service account is only needed for admin calls such as deleting a user.
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly auth: Auth;

  constructor(projectId: string) {
    // A named app, so another initializeApp() in the process can't collide with this one.
    const app: App = initializeApp({ projectId }, "token-verifier");
    this.auth = getAuth(app);
  }

  async verify(bearer: string): Promise<VerifiedIdentity | null> {
    const token = bearer.trim();
    if (!token) return null;

    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(token);
    } catch (err) {
      // `internal-error` is the SDK failing to fetch Google's signing keys, not a bad token.
      if (err instanceof FirebaseAuthError && err.code === "auth/internal-error") throw err;
      logger.debug({ code: err instanceof FirebaseAuthError ? err.code : undefined }, "firebase token rejected");
      return null;
    }

    // Email + password is the only sign-in method, so a token without an email (phone, anonymous) is refused.
    const email = decoded.email?.trim().toLowerCase();
    if (!email) return null;

    const name: unknown = decoded.name;
    const displayName = typeof name === "string" && name.trim() ? name.trim() : displayNameFromEmail(email);

    return {
      providerId: `firebase:${decoded.uid}`,
      email,
      displayName,
      emailVerified: decoded.email_verified === true,
    };
  }
}
