import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  verifyPasswordResetCode,
  type ActionCodeSettings,
  type Auth,
  type User,
} from "firebase/auth";
import { Platform } from "react-native";
import {
  AuthError,
  LINK_UNUSABLE,
  looksLikeEmail,
  normalizeEmail,
  type ActionCodes,
  type AuthProvider,
  type AuthUser,
} from "./auth-provider";
import { persistence } from "./firebase-persistence";

/**
 * Firebase Auth through the Firebase JS SDK — the same code on the web and in
 * Expo Go (no native module, so no dev build). Email + password only for now.
 *
 * Config comes from EXPO_PUBLIC_FIREBASE_* at bundle time. Each variable is
 * read by its full literal name because that is the only form Metro inlines.
 */
function firebaseConfig(): FirebaseOptions {
  const config = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `EXPO_PUBLIC_AUTH_MODE=firebase but the Firebase config is incomplete (missing: ${missing.join(", ")}). ` +
        "Set EXPO_PUBLIC_FIREBASE_API_KEY, _AUTH_DOMAIN, _PROJECT_ID and _APP_ID — see app/.env.example.",
    );
  }
  return config;
}

/** Fast Refresh re-runs this module; Firebase allows one app and one Auth per process. */
function firebaseAuth(): Auth {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig());
  let auth: Auth;
  try {
    auth = initializeAuth(app, { persistence });
  } catch {
    // auth/already-initialized — the earlier instance is the one to use (and
    // is already pointed at the emulator, if it should be).
    return getAuth(app);
  }
  // Development aid only: the local Firebase Auth emulator, which accepts any
  // password and hands out emailed links' codes over HTTP (see README).
  const emulator = process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR;
  if (emulator) connectAuthEmulator(auth, emulator, { disableWarnings: true });
  return auth;
}

/**
 * Where the "continue" in an emailed link should lead: the web app's own
 * origin. Natively there's no web origin the app can honestly claim (the
 * hosted demo is one deployment among several), so no continue URL is sent.
 */
function continueSettings(): ActionCodeSettings | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  return { url: window.location.origin };
}

/**
 * Sends an email with a continue URL when there is one, and without when
 * Firebase refuses it — a domain missing from Authentication → Settings →
 * Authorized domains shouldn't stop anyone from getting their link.
 */
async function sendWithContinueUrl(send: (settings?: ActionCodeSettings) => Promise<void>) {
  const settings = continueSettings();
  if (!settings) return send();
  try {
    await send(settings);
  } catch (err) {
    const code = codeOf(err);
    if (code !== "auth/unauthorized-continue-uri" && code !== "auth/invalid-continue-uri") throw err;
    // oxlint-disable-next-line no-console -- a deployment problem worth seeing in the console; the person still gets their email
    console.warn(
      `[auth] Firebase refused ${settings.url} as a continue URL (${code}); sent the email without one. ` +
        "Add the domain under Authentication → Settings → Authorized domains.",
    );
    await send();
  }
}

function codeOf(err: unknown) {
  return typeof err === "object" && err && "code" in err ? String(err.code) : undefined;
}

/** Firebase's error codes, said the way a family would want to hear them. */
function friendly(err: unknown): AuthError {
  const code = codeOf(err);
  switch (code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return new AuthError("That email and password don't match. Try again, or reset your password.", code);
    case "auth/email-already-in-use":
      return new AuthError("There's already an account with that email. Sign in instead?", code);
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return new AuthError("Choose a longer password — at least 6 characters.", code);
    case "auth/invalid-email":
    case "auth/missing-email":
      return new AuthError("That doesn't look like an email address.", code);
    case "auth/missing-password":
      return new AuthError("Enter your password.", code);
    case "auth/too-many-requests":
      return new AuthError("Too many attempts. Wait a few minutes, then try again.", code);
    case "auth/network-request-failed":
      return new AuthError("Can't reach the sign-in service. Check your connection and try again.", code);
    case "auth/user-disabled":
      return new AuthError("This account has been turned off. Write to hello@keepsake.app for help.", code);
    case "auth/requires-recent-login":
      return new AuthError("Sign in again to do that.", code);
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      // A build with the wrong (or placeholder) EXPO_PUBLIC_FIREBASE_* values.
      return new AuthError("Sign-in isn't set up correctly in this build. Please let us know.", code);
    case "auth/expired-action-code":
    case "auth/invalid-action-code":
      return new AuthError("This link has expired or has already been used.", LINK_UNUSABLE);
    default:
      return new AuthError("Something went wrong. Please try again.", code);
  }
}

/**
 * The same, for codes from emailed links: there, "user not found" means the
 * account behind the link is gone, not a mistyped password.
 */
function friendlyLink(err: unknown): AuthError {
  if (codeOf(err) === "auth/user-not-found") {
    return new AuthError("The account this link was for no longer exists.", "auth/user-not-found");
  }
  return friendly(err);
}

/** Firebase's out-of-band codes, behind the provider-neutral `ActionCodes`. */
class FirebaseActionCodes implements ActionCodes {
  constructor(private readonly auth: Auth) {}

  async check(code: string) {
    try {
      const { data } = await checkActionCode(this.auth, code);
      return { email: data.email ?? null, previousEmail: data.previousEmail ?? null };
    } catch (err) {
      throw friendlyLink(err);
    }
  }

  async apply(code: string) {
    try {
      await applyActionCode(this.auth, code);
    } catch (err) {
      throw friendlyLink(err);
    }
  }

  async verifyPasswordReset(code: string) {
    try {
      return await verifyPasswordResetCode(this.auth, code);
    } catch (err) {
      throw friendlyLink(err);
    }
  }

  async confirmPasswordReset(code: string, newPassword: string) {
    try {
      await confirmPasswordReset(this.auth, code, newPassword);
    } catch (err) {
      throw friendlyLink(err);
    }
  }
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user?.email) return null;
  return { email: user.email, emailVerified: user.emailVerified };
}

export class FirebaseAuthProvider implements AuthProvider {
  readonly mode = "firebase" as const;
  private readonly auth: Auth;
  readonly actionCodes: ActionCodes;
  private readonly listeners = new Set<(user: AuthUser | null) => void>();
  private restored = false;
  /**
   * While signUp is between creating the account and setting its name, the
   * new user isn't announced: the app's first API call would otherwise carry
   * a token without the name, and the server records names on first sight.
   */
  private holdChanges = false;

  constructor() {
    this.auth = firebaseAuth();
    this.actionCodes = new FirebaseActionCodes(this.auth);
    onAuthStateChanged(this.auth, () => {
      this.restored = true;
      if (!this.holdChanges) this.emit();
    });
  }

  get currentUser() {
    return toAuthUser(this.auth.currentUser);
  }

  onChange(callback: (user: AuthUser | null) => void) {
    this.listeners.add(callback);
    if (this.restored) callback(this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async signIn(email: string, password: string) {
    try {
      await signInWithEmailAndPassword(this.auth, normalizeEmail(email), password);
    } catch (err) {
      throw friendly(err);
    }
  }

  async signUp(email: string, password: string, displayName?: string) {
    const normalized = normalizeEmail(email);
    if (!looksLikeEmail(normalized)) throw new AuthError("That doesn't look like an email address.");
    this.holdChanges = true;
    try {
      const { user } = await createUserWithEmailAndPassword(this.auth, normalized, password);
      const name = displayName?.trim();
      if (name) {
        await updateProfile(user, { displayName: name });
        // The ID token minted at creation predates the name; mint one with it.
        await user.getIdToken(true);
      }
      // Not awaited into failure: the account exists either way, and the
      // verify-email nudge has a resend button.
      await sendWithContinueUrl((settings) => sendEmailVerification(user, settings)).catch(() => undefined);
    } catch (err) {
      throw friendly(err);
    } finally {
      this.holdChanges = false;
      this.emit();
    }
  }

  async signOut() {
    await signOut(this.auth);
  }

  async sendPasswordReset(email: string) {
    const normalized = normalizeEmail(email);
    if (!looksLikeEmail(normalized)) throw new AuthError("That doesn't look like an email address.");
    try {
      await sendWithContinueUrl((settings) => sendPasswordResetEmail(this.auth, normalized, settings));
    } catch (err) {
      // With email enumeration protection on (Firebase's default), an unknown
      // address succeeds silently — so a failure here is a real one.
      throw friendly(err);
    }
  }

  async sendVerificationEmail() {
    const user = this.auth.currentUser;
    if (!user) throw new AuthError("Sign in first.");
    try {
      await sendWithContinueUrl((settings) => sendEmailVerification(user, settings));
    } catch (err) {
      throw friendly(err);
    }
  }

  async reload() {
    const user = this.auth.currentUser;
    if (!user) return null;
    const wasVerified = user.emailVerified;
    try {
      await user.reload();
    } catch (err) {
      throw friendly(err);
    }
    // reload() doesn't fire onAuthStateChanged; tell the app ourselves.
    if (user.emailVerified !== wasVerified) this.emit();
    return this.currentUser;
  }

  async getToken(forceRefresh = false) {
    const user = this.auth.currentUser;
    if (!user) return null;
    // Refreshes by itself when the cached token is near expiry.
    return user.getIdToken(forceRefresh);
  }

  private emit() {
    const user = this.currentUser;
    for (const listener of this.listeners) listener(user);
  }
}
