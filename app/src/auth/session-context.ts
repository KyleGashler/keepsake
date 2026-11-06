import { createContext, use } from "react";
import type { MePayload, Membership } from "../api";
import type { AuthMode, AuthUser } from "./auth-provider";

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
  user: AuthUser | null;
  me: MePayload | null;
  memberships: Membership[];
  family: Membership | null;
  accountError: Error | null;
  notice: string | null;
  verifyNudgeDismissed: boolean;

  signOut: () => Promise<void>;
  selectFamily: (familyId: string) => void;
  createFamily: (name: string, displayName?: string) => Promise<void>;
  acceptInvite: (token: string) => Promise<void>;
  familyGone: (familyId: string) => Promise<void>;
  deleteAccount: (password?: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
  resendVerification: () => Promise<void>;
  // Mints a fresh token once verified: the old one still says email_verified=false.
  confirmVerified: () => Promise<boolean>;
  dismissVerifyNudge: () => void;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error("useSession outside <SessionProvider>");
  return session;
}

export function useCanContribute() {
  const role = useSession().family?.role;
  return role === "OWNER" || role === "CONTRIBUTOR";
}
