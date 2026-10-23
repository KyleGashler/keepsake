import { createContext, use } from "react";
import type { MePayload, Membership } from "../api";
import type { AuthMode, AuthUser } from "./auth-provider";

/**
 * Where the person is between opening the app and looking at an archive. The
 * root layout renders one screen per phase; only `ready` shows the app.
 *
 * - `restoring` — the provider is reading its persisted session.
 * - `loadingAccount` — signed in; asking the API who that is (`GET /me`).
 * - `verifyEmail` — the API wants this address verified first (403
 *   verify_email: it belongs to an existing dev-era account).
 * - `emailInUse` — the address belongs to another account (409).
 * - `createFamily` / `chooseFamily` — no family yet, or several and no choice.
 */
export type SessionPhase =
  | "restoring"
  | "signedOut"
  | "loadingAccount"
  | "verifyEmail"
  | "emailInUse"
  | "accountError"
  | "createFamily"
  | "chooseFamily"
  | "ready";

export type Session = {
  phase: SessionPhase;
  mode: AuthMode;
  /** The provider's view of the person — `emailVerified` updates without a round trip. */
  user: AuthUser | null;
  me: MePayload | null;
  memberships: Membership[];
  /** The family being looked at; null outside `ready`. */
  family: Membership | null;
  accountError: Error | null;
  /** Why the person was sent back to sign-in, if it wasn't their choice. */
  notice: string | null;
  verifyNudgeDismissed: boolean;

  signOut: () => Promise<void>;
  selectFamily: (familyId: string) => void;
  createFamily: (name: string, displayName?: string) => Promise<void>;
  /**
   * Accept an invite link's token and switch into that family. Rejects with
   * the API's error (`ApiError.code`: `verify_email`, `expired`, `used`,
   * `revoked`, `person_taken`, …); already being a member just switches.
   */
  acceptInvite: (token: string) => Promise<void>;
  /** Re-ask `GET /me` without leaving the current screen. */
  refreshAccount: () => Promise<void>;
  resendVerification: () => Promise<void>;
  /**
   * After the person says they've followed the link: reload the provider's
   * user and, if it's now verified, mint a fresh token (the old one still says
   * email_verified=false) and re-ask the API. Resolves to whether it worked.
   */
  confirmVerified: () => Promise<boolean>;
  dismissVerifyNudge: () => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession outside <SessionProvider>");
  return session;
}

/**
 * Whether this person may add to and edit the family being looked at — an
 * OWNER or CONTRIBUTOR. A VIEWER reads; the API refuses their writes
 * (`403 forbidden_role`), so the controls that would make one are hidden.
 */
export function useCanContribute() {
  const role = useSession().family?.role;
  return role === "OWNER" || role === "CONTRIBUTOR";
}
