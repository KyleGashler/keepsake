import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AuthError,
  looksLikeEmail,
  normalizeEmail,
  type AuthProvider,
  type AuthUser,
} from "./auth-provider";

const STORAGE_KEY = "littlebylittle.devAuth.email";

export const DEV_DEFAULT_EMAIL = "demo@littlebylittle.local";

// The server's DevTokenVerifier believes a `dev:<email>` token without proof; firebase mode rejects it.
export class DevAuthProvider implements AuthProvider {
  readonly mode = "dev" as const;
  private email: string | null = null;
  private restored = false;
  private readonly listeners = new Set<(user: AuthUser | null) => void>();

  constructor() {
    void this.restore();
  }

  get currentUser(): AuthUser | null {
    return this.email ? { email: this.email, emailVerified: true } : null;
  }

  onChange(callback: (user: AuthUser | null) => void) {
    this.listeners.add(callback);
    if (this.restored) callback(this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async signIn(email: string) {
    const normalized = normalizeEmail(email);
    if (!looksLikeEmail(normalized)) throw new AuthError("That doesn't look like an email address.");
    await this.write(normalized);
    this.set(normalized);
  }

  async signUp(email: string) {
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

  async deleteAccount({ deleteOnServer }: { password?: string; deleteOnServer: () => Promise<void> }) {
    if (!this.email) throw new AuthError("Sign in first.");
    await deleteOnServer();
    await this.signOut();
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
