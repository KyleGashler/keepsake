export type AuthUser = {
  email: string;
  /** Gates invite acceptance, not the app. */
  emailVerified: boolean;
};

export type AuthMode = "dev" | "firebase";

export interface AuthProvider {
  readonly mode: AuthMode;
  /** Null while signed out — and until the persisted session has been restored. */
  readonly currentUser: AuthUser | null;

  onChange: (callback: (user: AuthUser | null) => void) => () => void;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  reload: () => Promise<AuthUser | null>;
  /** `forceRefresh` mints a new token so changed claims (email_verified) reach the server. */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  // If `deleteOnServer` rejects the identity is kept; if the provider delete fails after it, sign out anyway.
  // The provider identity is deleted here because the API holds no credentials to do it.
  deleteAccount: (input: { password?: string; deleteOnServer: () => Promise<void> }) => Promise<void>;
  readonly actionCodes?: ActionCodes;
}

export type ActionCodeInfo = {
  email: string | null;
  previousEmail: string | null;
};

export interface ActionCodes {
  /** Reads the code without using it up. */
  check: (code: string) => Promise<ActionCodeInfo>;
  apply: (code: string) => Promise<void>;
  verifyPasswordReset: (code: string) => Promise<string>;
  /** Does not sign in. */
  confirmPasswordReset: (code: string, newPassword: string) => Promise<void>;
}

export const LINK_UNUSABLE = "link-unusable";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
