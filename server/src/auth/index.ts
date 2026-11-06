import { logger } from "../lib/logger.js";
import { DevTokenVerifier } from "./DevTokenVerifier.js";
import { FirebaseTokenVerifier } from "./FirebaseTokenVerifier.js";
import type { TokenVerifier } from "./TokenVerifier.js";

export type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";
export { DevTokenVerifier } from "./DevTokenVerifier.js";
export { FirebaseTokenVerifier } from "./FirebaseTokenVerifier.js";

export const AUTH_MODE = process.env.AUTH_MODE ?? "dev";

export function createTokenVerifier(): TokenVerifier {
  const isProduction = process.env.NODE_ENV === "production";
  const mode = AUTH_MODE;

  if (mode === "firebase") {
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) {
      throw new Error(
        "refusing to start: AUTH_MODE=firebase needs FIREBASE_PROJECT_ID " +
          "(the Firebase project whose ID tokens this API accepts, e.g. littlebylittle-prod).",
      );
    }
    logger.info({ projectId }, "auth: verifying Firebase ID tokens");
    return new FirebaseTokenVerifier(projectId);
  }

  if (mode === "dev") {
    if (isProduction) {
      if (process.env.ALLOW_DEV_AUTH_IN_PROD !== "1") {
        throw new Error(
          "refusing to start: AUTH_MODE=dev is not allowed in production. " +
            "Use AUTH_MODE=firebase with FIREBASE_PROJECT_ID, or set " +
            "ALLOW_DEV_AUTH_IN_PROD=1 to run with no real authentication.",
        );
      }
      logger.warn(
        "AUTH_MODE=dev in production with ALLOW_DEV_AUTH_IN_PROD=1 — " +
          "anyone can sign in as anyone by sending 'Authorization: Bearer dev:<email>'.",
      );
    }
    return new DevTokenVerifier();
  }

  throw new Error(
    `refusing to start: unknown AUTH_MODE=${JSON.stringify(mode)}. Use "dev" or "firebase".`,
  );
}
