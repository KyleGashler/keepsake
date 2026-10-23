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
  /**
   * The codes in links the provider emails (verify, reset, recover), for the
   * page those links open (/auth/action). Absent when the provider sends no
   * such email — dev mode.
   */
  readonly actionCodes?: ActionCodes;
}

/** What an emailed link's code says, read without spending it. */
export type ActionCodeInfo = {
  /** The address the email went to; for an email recovery, the address being restored. */
  email: string | null;
  /** Email recovery only: the address the account is being changed back from. */
  previousEmail: string | null;
};

/**
 * One-time codes from emailed links. Each method rejects with an `AuthError`;
 * an expired, already-used or mangled code is `code === LINK_UNUSABLE`.
 */
export interface ActionCodes {
  /** Reads the code without using it up. */
  check: (code: string) => Promise<ActionCodeInfo>;
  /** Uses up a verify-email or recover-email code. */
  apply: (code: string) => Promise<void>;
  /** Checks a password-reset code; resolves to the account's email. */
  verifyPasswordReset: (code: string) => Promise<string>;
  /** Uses up a password-reset code, setting the new password. Does not sign in. */
  confirmPasswordReset: (code: string, newPassword: string) => Promise<void>;
}

/** `AuthError.code` for an emailed link that has expired, been used, or was cut short — whatever the provider. */
export const LINK_UNUSABLE = "link-unusable";

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
