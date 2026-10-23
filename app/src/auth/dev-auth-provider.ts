import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AuthError,
  looksLikeEmail,
  normalizeEmail,
  type AuthProvider,
  type AuthUser,
} from "./auth-provider";

/**
 * AsyncStorage is the device's storage natively and `window.localStorage` on
 * the web (that is its web implementation), so one key covers both.
 */
const STORAGE_KEY = "keepsake.devAuth.email";

/** Seeded OWNER of the demo family — what the dev sign-in form starts with. */
export const DEV_DEFAULT_EMAIL = "demo@keepsake.local";

/**
 * Development sign-in: an email and nothing else. The token is `dev:<email>`,
 * which the server's DevTokenVerifier believes without proof (and which a
 * server in firebase mode rejects). Exists so local development, the seed
 * data and Expo Go work with no Firebase project at all.
 */
export class DevAuthProvider implements AuthProvider {
  readonly mode = "dev" as const;
  private email: string | null = null;
  private restored = false;
  private readonly listeners = new Set<(user: AuthUser | null) => void>();

  constructor() {
    void this.restore();
  }

  get currentUser(): AuthUser | null {
    // Nothing to prove in dev, so every address counts as verified.
    return this.email ? { email: this.email, emailVerified: true } : null;
  }

  onChange(callback: (user: AuthUser | null) => void) {
    this.listeners.add(callback);
    if (this.restored) callback(this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /** No password: the email is the whole credential. */
  async signIn(email: string) {
    const normalized = normalizeEmail(email);
    if (!looksLikeEmail(normalized)) throw new AuthError("That doesn't look like an email address.");
    await this.write(normalized);
    this.set(normalized);
  }

  async signUp(email: string) {
    // A dev account comes into being on its first request; signing up is signing in.
    await this.signIn(email);
  }

  async signOut() {
    await this.write(null);
    this.set(null);
  }

  async sendPasswordReset() {
    // No passwords in dev; the form that would call this isn't shown.
  }

  async sendVerificationEmail() {
    // Dev identities are verified by definition.
  }

  async reload() {
    return this.currentUser;
  }

  async getToken() {
    return this.email ? `dev:${this.email}` : null;
  }

  private async restore() {
    let saved: string | null = null;
    try {
      saved = await AsyncStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage blocked (a private window): start signed out.
    }
    this.email = saved && looksLikeEmail(saved) ? saved : null;
    this.restored = true;
    this.emit();
  }

  private async write(email: string | null) {
    try {
      await (email ? AsyncStorage.setItem(STORAGE_KEY, email) : AsyncStorage.removeItem(STORAGE_KEY));
    } catch {
      // Not remembered across reloads; the session itself still works.
    }
  }

  private set(email: string | null) {
    this.email = email;
    this.restored = true;
    this.emit();
  }

  private emit() {
    const user = this.currentUser;
    for (const listener of this.listeners) listener(user);
  }
}
