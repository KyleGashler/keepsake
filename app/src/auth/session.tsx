import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  apiGet,
  apiSend,
  holdRequests,
  onFamilyLost,
  onUnauthorized,
  type AcceptedInvite,
  type MePayload,
} from "../api";
import { forgetEverything, forgetFamiliesExcept, forgetFamily, queryClient } from "../query";
import { leaveFor } from "../routes";
import { auth, type AuthUser } from ".";
import { getFamilyId, rememberedFamilyId, setFamilyId, useFamilyId } from "./family-store";
import { SessionContext, type Session, type SessionPhase } from "./session-context";

type Account =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; me: MePayload }
  | { status: "verifyEmail" }
  | { status: "emailInUse" }
  | { status: "error"; error: Error };

function familyIdIn(body: unknown): string | null {
  if (body && typeof body === "object" && "familyId" in body && typeof body.familyId === "string") {
    return body.familyId;
  }
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(auth.currentUser);
  const [account, setAccount] = useState<Account>({ status: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [verifyNudgeDismissed, setVerifyNudgeDismissed] = useState(false);
  const familyId = useFamilyId();

  // Only the newest /me may land: a sign-out or a second sign-in supersedes it.
  const latestLoad = useRef(0);
  const signedInAs = useRef<string | null>(null);

  const loadAccount = useCallback(async ({ quiet = false, pickFirst = false } = {}) => {
    const load = ++latestLoad.current;
    if (!quiet) setAccount({ status: "loading" });
    try {
      // Always fresh: membership decides what every other query may show.
      const me = await queryClient.fetchQuery({
        queryKey: ["account", "me"],
        queryFn: () => apiGet<MePayload>("/api/me"),
        staleTime: 0,
        retry: false,
      });
      const remembered = getFamilyId() ?? (await rememberedFamilyId());
      if (load !== latestLoad.current) return;
      const ids = me.memberships.map((m) => m.familyId);
      forgetFamiliesExcept(ids);
      if (ids.length === 1) setFamilyId(ids[0]);
      else if (remembered && ids.includes(remembered)) setFamilyId(remembered);
      else if (pickFirst && ids.length) setFamilyId(ids[0]);
      else setFamilyId(null, { remember: false });
      setAccount({ status: "loaded", me });
    } catch (err) {
      if (load !== latestLoad.current) return;
      const status = err instanceof ApiError ? err.status : null;
      // 401: apiFetch has already started the sign-out.
      if (status === 401) return;
      if (status === 403) setAccount({ status: "verifyEmail" });
      else if (status === 409) setAccount({ status: "emailInUse" });
      else if (!quiet) setAccount({ status: "error", error: err instanceof Error ? err : new Error(String(err)) });
    }
  }, []);

  useEffect(
    () =>
      auth.onChange((next) => {
        setRestored(true);
        setUser(next);
        // A changed emailVerified on the same person is not a new account.
        const email = next?.email ?? null;
        if (email === signedInAs.current) return;
        signedInAs.current = email;
        forgetEverything();
        if (email) {
          void loadAccount();
        } else {
          // Ends any request hold left by an account deletion.
          holdRequests(false);
          latestLoad.current++;
          setAccount({ status: "idle" });
          setVerifyNudgeDismissed(false);
          setFamilyId(null, { remember: false });
        }
      }),
    [loadAccount],
  );

  useEffect(() => {
    onUnauthorized(() => {
      setNotice("You've been signed out. Sign in again to pick up where you left off.");
      void auth.signOut();
    });
  }, []);

  const meRef = useRef<MePayload | null>(null);
  useEffect(() => {
    meRef.current = account.status === "loaded" ? account.me : null;
  }, [account]);

  const familyGone = useCallback(
    async (goneId: string) => {
      const me = meRef.current;
      if (me) {
        const rest = me.memberships.filter((m) => m.familyId !== goneId);
        setAccount({ status: "loaded", me: { ...me, memberships: rest } });
        if (getFamilyId() === goneId) setFamilyId(rest[0]?.familyId ?? null);
      }
      forgetFamily(goneId);
      await loadAccount({ quiet: true, pickFirst: true });
    },
    [loadAccount],
  );

  useEffect(() => {
    onFamilyLost((lostId) => void familyGone(lostId));
  }, [familyGone]);

  const { mutateAsync: deleteOnServer } = useMutation({ mutationFn: () => apiSend("/api/me", "DELETE") });
  const { mutateAsync: postFamily } = useMutation({
    mutationFn: (body: { name: string; displayName?: string }) =>
      apiSend<{ family: { id: string } }>("/api/families", "POST", body),
  });
  const { mutateAsync: postAccept } = useMutation({
    mutationFn: (token: string) => apiSend<AcceptedInvite>(`/api/invites/${encodeURIComponent(token)}/accept`, "POST"),
  });

  const deleteAccount = useCallback(async (password?: string) => {
    setNotice(null);
    await auth.deleteAccount({
      password,
      deleteOnServer: async () => {
        await deleteOnServer();
        // Until the provider signs out, any request would recreate an account for this identity.
        holdRequests(true);
        leaveFor(() => undefined);
      },
    });
  }, [deleteOnServer]);

  const signOut = useCallback(async () => {
    setNotice(null);
    await auth.signOut();
  }, []);

  const createFamily = useCallback(
    async (name: string, displayName?: string) => {
      const res = await postFamily({ name, ...(displayName ? { displayName } : {}) });
      await loadAccount({ quiet: true });
      setFamilyId(res.family.id);
    },
    [loadAccount, postFamily],
  );

  const acceptInvite = useCallback(
    async (token: string) => {
      let joined: string;
      try {
        const res = await postAccept(token);
        joined = res.membership.familyId;
      } catch (err) {
        const already = err instanceof ApiError && err.code === "already_member" ? familyIdIn(err.body) : null;
        if (!already) throw err;
        joined = already;
      }
      await loadAccount({ quiet: true });
      setFamilyId(joined);
    },
    [loadAccount, postAccept],
  );

  const confirmVerified = useCallback(async () => {
    const reloaded = await auth.reload();
    if (!reloaded?.emailVerified) return false;
    await auth.getToken(true);
    await loadAccount({ quiet: account.status === "loaded" });
    return true;
  }, [account.status, loadAccount]);

  const session = useMemo<Session>(() => {
    const me = account.status === "loaded" ? account.me : null;
    const memberships = me?.memberships ?? [];
    const current = memberships.find((m) => m.familyId === familyId) ?? null;

    let phase: SessionPhase;
    if (!restored) phase = "restoring";
    else if (!user) phase = "signedOut";
    else if (account.status === "idle" || account.status === "loading") phase = "loadingAccount";
    else if (account.status === "verifyEmail") phase = "verifyEmail";
    else if (account.status === "emailInUse") phase = "emailInUse";
    else if (account.status === "error") phase = "accountError";
    else if (memberships.length === 0) phase = "createFamily";
    else if (!current) phase = "chooseFamily";
    else phase = "ready";

    return {
      phase,
      mode: auth.mode,
      user,
      me,
      memberships,
      family: phase === "ready" ? current : null,
      accountError: account.status === "error" ? account.error : null,
      notice,
      verifyNudgeDismissed,
      signOut,
      selectFamily: (id) => setFamilyId(id),
      createFamily,
      acceptInvite,
      familyGone,
      deleteAccount,
      refreshAccount: () => loadAccount({ quiet: account.status === "loaded" }),
      resendVerification: () => auth.sendVerificationEmail(),
      confirmVerified,
      dismissVerifyNudge: () => setVerifyNudgeDismissed(true),
    };
  }, [
    account,
    familyId,
    restored,
    user,
    notice,
    verifyNudgeDismissed,
    signOut,
    createFamily,
    acceptInvite,
    familyGone,
    deleteAccount,
    loadAccount,
    confirmVerified,
  ]);

  return <SessionContext value={session}>{children}</SessionContext>;
}
