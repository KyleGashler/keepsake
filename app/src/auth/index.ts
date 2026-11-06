import type { AuthMode, AuthProvider } from "./auth-provider";
import { DevAuthProvider } from "./dev-auth-provider";
import { FirebaseAuthProvider } from "./firebase-auth-provider";

export type { ActionCodeInfo, ActionCodes, AuthMode, AuthProvider, AuthUser } from "./auth-provider";
export { AuthError, LINK_UNUSABLE } from "./auth-provider";
export { DEV_DEFAULT_EMAIL } from "./dev-auth-provider";

// Firebase's "custom action URL" points here (README → Auth).
export const AUTH_ACTION_PATH = "/auth/action";

// Baked in at bundle time and must match the API's AUTH_MODE: a dev token sent to a firebase API is a 401.
export const AUTH_MODE: AuthMode = process.env.EXPO_PUBLIC_AUTH_MODE === "firebase" ? "firebase" : "dev";

export const auth: AuthProvider = AUTH_MODE === "firebase" ? new FirebaseAuthProvider() : new DevAuthProvider();
