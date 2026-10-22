import { initializeApp, type App } from "firebase-admin/app";
import { FirebaseAuthError, getAuth, type Auth } from "firebase-admin/auth";
import { logger } from "../lib/logger.js";
import { displayNameFromEmail } from "./display-name.js";
import type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";

/**
 * Firebase Auth ID tokens: a JWT the client gets from the Firebase JS SDK and
 * sends as `Authorization: Bearer <idToken>`.
 *
 * The admin SDK is initialised with the project id and nothing else. Verifying
 * an ID token needs no credentials: it checks the signature against Google's
 * public securetoken certificates (fetched over plain HTTPS and cached), then
 * `aud`/`iss` against the project id, then `exp`/`iat`/`auth_time`. A service
 * account only becomes necessary for admin calls such as deleting a user
 * (A16) or checking revocation — neither happens here.
 */
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly auth: Auth;

  constructor(projectId: string) {
    // A named app, so nothing else in the process that calls initializeApp()
    // (a future admin task, say) collides with this one.
    const app: App = initializeApp({ projectId }, "keepsake-token-verifier");
    this.auth = getAuth(app);
  }

  async verify(bearer: string): Promise<VerifiedIdentity | null> {
    const token = bearer.trim();
    if (!token) return null;

    let decoded;
    try {
      decoded = await this.auth.verifyIdToken(token);
    } catch (err) {
      // `internal-error` is the SDK failing to fetch Google's signing keys —
      // nothing is wrong with the token, so don't answer as if there were.
      if (err instanceof FirebaseAuthError && err.code === "auth/internal-error") throw err;
      // Expired, malformed, wrong project, bad signature: a 401, quietly.
      logger.debug({ code: err instanceof FirebaseAuthError ? err.code : undefined }, "firebase token rejected");
      return null;
    }

    // Email + password is the only sign-in method at launch, so every account
    // has one; a token without it (phone auth, anonymous) has nothing for
    // `User.email` and is refused.
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
