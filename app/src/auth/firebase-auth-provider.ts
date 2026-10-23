import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import {
  AuthError,
  looksLikeEmail,
  normalizeEmail,
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
  try {
    return initializeAuth(app, { persistence });
  } catch {
    // auth/already-initialized — the earlier instance is the one to use.
    return getAuth(app);
  }
}

/** Firebase's error codes, said the way a family would want to hear them. */
function friendly(err: unknown): AuthError {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : undefined;
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
    default:
      return new AuthError("Something went wrong. Please try again.", code);
  }
}

function toAuthUser(user: User | null): AuthUser | null {
  if (!user?.email) return null;
  return { email: user.email, emailVerified: user.emailVerified };
}

export class FirebaseAuthProvider implements AuthProvider {
  readonly mode = "firebase" as const;
  private readonly auth: Auth;
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
      await sendEmailVerification(user).catch(() => undefined);
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
      await sendPasswordResetEmail(this.auth, normalized);
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
      await sendEmailVerification(user);
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
