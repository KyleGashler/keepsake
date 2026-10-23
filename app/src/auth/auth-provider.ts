/**
 * The one seam between the app and whoever signs people in — the client half
 * of the server's TokenVerifier. Screens and the API client only ever see
 * this; `EXPO_PUBLIC_AUTH_MODE` picks the implementation (src/auth/index.ts).
 */

/** Who is signed in, as far as the provider knows. */
export type AuthUser = {
  email: string;
  /** Has followed the link the provider emailed. Gates invite acceptance, not the app. */
  emailVerified: boolean;
};

export type AuthMode = "dev" | "firebase";

export interface AuthProvider {
  readonly mode: AuthMode;
  /** Null while signed out — and until the persisted session has been restored. */
  readonly currentUser: AuthUser | null;

  /**
   * Called once the persisted session has been restored (with the user or
   * null), and then on every sign-in, sign-out and `reload()` that changed
   * something. Returns an unsubscribe.
   */
  onChange: (callback: (user: AuthUser | null) => void) => () => void;

  /** Rejects with an `AuthError` whose message can be shown as is. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Creates the account, signs in, and sends the verification email. */
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  /** Re-read the user from the provider (e.g. after verifying in another tab). */
  reload: () => Promise<AuthUser | null>;
  /**
   * The bearer token for the API, or null when signed out. Fresh enough to
   * use; `forceRefresh` mints a new one so changed claims (email_verified)
   * reach the server.
   */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
}

/** A sign-in problem, already phrased for the person in front of the screen. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Shared by both providers so the forms behave the same in either mode. */
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
