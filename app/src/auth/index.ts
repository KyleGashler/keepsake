import type { AuthMode, AuthProvider } from "./auth-provider";
import { DevAuthProvider } from "./dev-auth-provider";
import { FirebaseAuthProvider } from "./firebase-auth-provider";

export type { ActionCodeInfo, ActionCodes, AuthMode, AuthProvider, AuthUser } from "./auth-provider";
export { AuthError, LINK_UNUSABLE } from "./auth-provider";
export { DEV_DEFAULT_EMAIL } from "./dev-auth-provider";

/**
 * The page the links in sign-in emails open — Firebase's "custom action URL"
 * points here (README → Auth). Drawn by src/components/auth-action-screen.tsx.
 */
export const AUTH_ACTION_PATH = "/auth/action";

/**
 * `EXPO_PUBLIC_AUTH_MODE` is baked in at bundle time: `dev` (the default —
 * local development, matching the API's AUTH_MODE=dev) or `firebase`. The
 * app and the API must agree; a dev token sent to a firebase API is a 401.
 */
export const AUTH_MODE: AuthMode = process.env.EXPO_PUBLIC_AUTH_MODE === "firebase" ? "firebase" : "dev";

/** The app's one sign-in provider. Nothing outside src/auth/ picks one. */
export const auth: AuthProvider = AUTH_MODE === "firebase" ? new FirebaseAuthProvider() : new DevAuthProvider();
