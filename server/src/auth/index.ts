import { logger } from "../lib/logger.js";
import { DevTokenVerifier } from "./DevTokenVerifier.js";
import type { TokenVerifier } from "./TokenVerifier.js";

export type { TokenVerifier, VerifiedIdentity } from "./TokenVerifier.js";
export { DevTokenVerifier } from "./DevTokenVerifier.js";

export const AUTH_MODE = process.env.AUTH_MODE ?? "dev";

/**
 * Pick the verifier for this process, and refuse to start rather than run a
 * production deployment where a bearer token is a self-assertion.
 *
 * The escape hatch exists for exactly one reason: the hosted Fly demo is
 * already running with no accounts at all, and losing it while Firebase (B1)
 * is provisioned would be worse than the (already total) exposure it has
 * today. It is loud, opt-in, and temporary.
 */
export function createTokenVerifier(): TokenVerifier {
  const isProduction = process.env.NODE_ENV === "production";
  const mode = AUTH_MODE;

  if (mode === "dev") {
    if (isProduction) {
      if (process.env.ALLOW_DEV_AUTH_IN_PROD !== "1") {
        throw new Error(
          "refusing to start: AUTH_MODE=dev is not allowed in production. " +
            "Configure a real token verifier (AUTH_MODE=firebase, task B1), or set " +
            "ALLOW_DEV_AUTH_IN_PROD=1 to keep the open demo running with no real authentication.",
        );
      }
      logger.warn(
        "AUTH_MODE=dev in production with ALLOW_DEV_AUTH_IN_PROD=1 — " +
          "anyone can sign in as anyone by sending 'Authorization: Bearer dev:<email>'. " +
          "This is the hosted demo's open door; remove it when B1 lands.",
      );
    }
    return new DevTokenVerifier();
  }

  // No real verifier is implemented yet (B1 adds FirebaseTokenVerifier here).
  throw new Error(
    `refusing to start: unknown AUTH_MODE=${JSON.stringify(mode)}. The only implemented mode is "dev".`,
  );
}
