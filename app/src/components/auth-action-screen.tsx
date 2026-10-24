import { useGlobalSearchParams } from "expo-router";
import { useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth, AuthError, LINK_UNUSABLE, type ActionCodeInfo, type ActionCodes } from "../auth";
import { useSession } from "../auth/session-context";
import { SUPPORT_EMAIL } from "../support";
import { AuthFrame, Notice, TextLink } from "./auth-screens";
import { Field, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * Where the links in sign-in emails land — Firebase's "custom action URL",
 * in place of its unbranded hosted page. Firebase appends `mode`, `oobCode`,
 * `apiKey`, `continueUrl` and `lang`; only the first two matter here (when
 * the person is done they go to the app's start, which is where the continue
 * URL points anyway).
 *
 * The root layout shows this at AUTH_ACTION_PATH in every session phase,
 * signed out included, and calls `onDone` when the person moves on — from
 * then on the usual phase screen (sign-in, the archive, …) takes over.
 */

type Mode = "verifyEmail" | "resetPassword" | "recoverEmail";

function isMode(mode: string | undefined): mode is Mode {
  return mode === "verifyEmail" || mode === "resetPassword" || mode === "recoverEmail";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function asAuthError(err: unknown) {
  return err instanceof AuthError ? err : new AuthError("Something went wrong. Please try again.");
}

function isUnusable(err: AuthError) {
  return err.code === LINK_UNUSABLE;
}

export function AuthActionScreen({ onDone }: { onDone: () => void }) {
  const params = useGlobalSearchParams<{ mode?: string; oobCode?: string }>();
  const mode = first(params.mode);
  const code = first(params.oobCode);
  const codes = auth.actionCodes;

  if (!codes) return <NotInDevMode onDone={onDone} />;
  if (!code || !isMode(mode)) return <BrokenLink onDone={onDone} />;
  switch (mode) {
    case "verifyEmail":
      return <VerifyEmail code={code} codes={codes} onDone={onDone} />;
    case "resetPassword":
      return <ResetPassword code={code} codes={codes} onDone={onDone} />;
    default:
      return <RecoverEmail code={code} codes={codes} onDone={onDone} />;
  }
}

type ModeProps = { code: string; codes: ActionCodes; onDone: () => void };

// ---------------------------------------------------------------------------
// Spending a code exactly once

/**
 * Codes are single-use, and StrictMode (or a remount) runs effects twice — a
 * second `apply` would fail with "already used" and hide the success. So each
 * code's work starts once per page load, and its promise is kept here, one
 * map per kind of work.
 */
const verifyRuns = new Map<string, Promise<{ email: string | null }>>();
const resetChecks = new Map<string, Promise<string>>();
const recoverRuns = new Map<string, Promise<ActionCodeInfo>>();

type Outcome<T> = { status: "pending" } | { status: "done"; value: T } | { status: "failed"; error: AuthError };

/**
 * Runs `work` once per `key` (not at all while `key` is null) and reports
 * how it went; `retry` starts it afresh.
 */
function useOnce<T>(runs: Map<string, Promise<T>>, key: string | null, work: () => Promise<T>) {
  const [outcome, setOutcome] = useState<Outcome<T>>({ status: "pending" });
  const [attempt, setAttempt] = useState(0);
  const start = useEffectEvent(() => work());
  const runKey = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (runKey === null) return;
    let live = true;
    let promise = runs.get(runKey);
    if (!promise) {
      promise = start();
      runs.set(runKey, promise);
    }
    promise
      .then((value) => {
        if (live) setOutcome({ status: "done", value });
      })
      .catch((err: unknown) => {
        if (live) setOutcome({ status: "failed", error: asAuthError(err) });
      });
    return () => {
      live = false;
    };
  }, [runs, runKey]);

  const retry = () => {
    setOutcome({ status: "pending" });
    setAttempt((n) => n + 1);
  };
  return [outcome, retry] as const;
}

// ---------------------------------------------------------------------------
// verifyEmail

function VerifyEmail({ code, codes, onDone }: ModeProps) {
  const session = useSession();
  // Wait for the saved session: whether someone is signed in here decides
  // what happens after the code is applied.
  const restored = session.phase !== "restoring";
  const [outcome, retry] = useOnce(verifyRuns, restored ? code : null, async () => {
    const { email } = await codes.check(code);
    await codes.apply(code);
    const here = session.user;
    if (here && email && here.email.toLowerCase() === email.toLowerCase()) {
      // Signed in as the person just verified: reload them and mint a token
      // that says email_verified, so the API sees it now. This is also what
      // finishes a dev-account takeover that was waiting on verify_email.
      // The code is spent either way, so a failure here isn't the link's
      // fault — Family Hub's "I've verified" can finish the job.
      await session.confirmVerified().catch(() => false);
    }
    return { email };
  });

  if (outcome.status === "pending") return <Checking />;

  const signedIn = session.user !== null;
  const continueButton = <SheetButton label={signedIn ? "Continue" : "Sign in"} onPress={onDone} />;

  if (outcome.status === "done") {
    const { email } = outcome.value;
    return (
      <AuthFrame
        eyebrow="All set"
        title="Your email is verified"
        subtitle={
          signedIn
            ? `Thank you — ${email ?? "your address"} is confirmed.`
            : `Thank you — ${email ?? "your address"} is confirmed. Sign in to carry on.`
        }
      >
        {continueButton}
      </AuthFrame>
    );
  }

  if (!isUnusable(outcome.error)) return <Failed error={outcome.error} retry={retry} onDone={onDone} />;

  if (session.user?.emailVerified) {
    return (
      <AuthFrame
        eyebrow="All set"
        title="You're already verified"
        subtitle={`This link has been used before, and ${session.user.email} is verified — there's nothing more to do.`}
      >
        {continueButton}
      </AuthFrame>
    );
  }
  if (signedIn) return <ResendVerification onDone={onDone} />;
  return (
    <AuthFrame
      eyebrow="Link expired"
      title="This link has expired"
      subtitle="Verification links work once, and only for a while. If you've verified already, you're all set. If not, sign in and send yourself a new one from Family Hub."
    >
      {continueButton}
    </AuthFrame>
  );
}

/** Expired verify link while signed in here: offer a fresh one. */
function ResendVerification({ onDone }: { onDone: () => void }) {
  const { user, resendVerification } = useSession();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await resendVerification();
      setSent(true);
    } catch (err) {
      setError(asAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      eyebrow="Link expired"
      title="This link has expired"
      subtitle={`Verification links work once, and only for a while. We can send a fresh one to ${user?.email ?? "you"}.`}
      footer={<TextLink label="Continue to little by little" onPress={onDone} />}
    >
      {sent ? <Notice>Sent. It can take a minute or two to arrive — check spam if it doesn't.</Notice> : null}
      <SheetError message={error} />
      <SheetButton
        label={sent ? "Send it again" : "Send a new link"}
        variant={sent ? "secondary" : "primary"}
        onPress={() => void resend()}
        busy={busy}
      />
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// resetPassword

function ResetPassword({ code, codes, onDone }: ModeProps) {
  const session = useSession();
  const [checked, retry] = useOnce(resetChecks, code, () => codes.verifyPasswordReset(code));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After the new password is set: signing in with it, or (if that failed) asking them to. */
  const [stage, setStage] = useState<"form" | "entering" | "changed" | "expired">("form");

  const email = checked.status === "done" ? checked.value : null;

  // Into the app once the provider reports the person signed in.
  const signedInAs = session.user?.email.toLowerCase() ?? null;
  useEffect(() => {
    if (stage === "entering" && email && signedInAs === email.toLowerCase()) onDone();
  }, [stage, email, signedInAs, onDone]);

  if (checked.status === "pending") return <Checking />;
  if (checked.status === "failed") {
    if (isUnusable(checked.error)) return <RequestReset kind="reset" onDone={onDone} />;
    return <Failed error={checked.error} retry={retry} onDone={onDone} />;
  }
  if (stage === "expired") return <RequestReset kind="reset" onDone={onDone} />;
  if (stage === "entering") return <Checking title="Password changed" subtitle="Signing you in…" />;
  if (stage === "changed") {
    return (
      <AuthFrame
        eyebrow="All set"
        title="Your password is changed"
        subtitle={`Sign in as ${email ?? "yourself"} with your new password.`}
      >
        <SheetButton label="Sign in" onPress={onDone} />
      </AuthFrame>
    );
  }

  const submit = async () => {
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await codes.confirmPasswordReset(code, password);
    } catch (err) {
      const authError = asAuthError(err);
      if (isUnusable(authError)) setStage("expired");
      else setError(authError.message);
      setBusy(false);
      return;
    }
    try {
      await auth.signIn(email, password);
      setStage("entering");
    } catch {
      setStage("changed");
    }
  };

  return (
    <AuthFrame
      eyebrow="It happens"
      title="Choose a new password"
      subtitle={`For your little by little account, ${email}.`}
    >
      <Field label="New password" hint="At least 6 characters.">
        <SheetInput
          value={password}
          onChangeText={setPassword}
          placeholder="Choose a password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={password ? () => void submit() : undefined}
          accessibilityLabel="New password"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Save and sign in" onPress={() => void submit()} busy={busy} disabled={!password} />
    </AuthFrame>
  );
}

/**
 * An expired reset (or recovery) link: ask for a new reset email right here,
 * since the person may well be signed out and the old code can't tell us
 * whose it was.
 */
function RequestReset({ kind, onDone }: { kind: "reset" | "recover"; onDone: () => void }) {
  const { user } = useSession();
  const [email, setEmail] = useState(user?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await auth.sendPasswordReset(email);
      setSentTo(email.trim());
    } catch (err) {
      setError(asAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthFrame
        eyebrow="On its way"
        title="Check your inbox"
        subtitle={`If there's a little by little account for ${sentTo}, a new link to choose a password is on its way. It can take a minute or two.`}
      >
        <SheetButton label="Back to little by little" variant="secondary" onPress={onDone} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      eyebrow="Link expired"
      title="This link has expired"
      subtitle={
        kind === "reset"
          ? "Password reset links work once, and only for an hour. Send yourself a new one."
          : `This link has been used or has expired. If your email was changed without you, reset your password to be safe — and write to ${SUPPORT_EMAIL}.`
      }
      footer={<TextLink label="Back to little by little" onPress={onDone} />}
    >
      <Field label="Email">
        <SheetInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={email.trim() ? () => void send() : undefined}
          accessibilityLabel="Email"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Send a new reset link" onPress={() => void send()} busy={busy} disabled={!email.trim()} />
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// recoverEmail

/** Someone changed the account's email; this link changes it back. */
function RecoverEmail({ code, codes, onDone }: ModeProps) {
  const [outcome, retry] = useOnce(recoverRuns, code, async () => {
    const info = await codes.check(code);
    await codes.apply(code);
    return info;
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (outcome.status === "pending") return <Checking />;
  if (outcome.status === "failed") {
    if (isUnusable(outcome.error)) return <RequestReset kind="recover" onDone={onDone} />;
    return <Failed error={outcome.error} retry={retry} onDone={onDone} />;
  }

  const email = outcome.value.email;
  const sendReset = async () => {
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await auth.sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(asAuthError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      eyebrow="Changed back"
      title="Your email is restored"
      subtitle={`Your account's email is ${email ?? "back to what it was"} again. If you didn't ask for it to change, someone else may know your password — reset it to be safe.`}
      footer={<TextLink label="Continue to little by little" onPress={onDone} />}
    >
      {sent ? <Notice>{`A link to choose a new password is on its way to ${email}.`}</Notice> : null}
      <SheetError message={error} />
      {email && !sent ? (
        <SheetButton label="Reset my password" onPress={() => void sendReset()} busy={busy} />
      ) : null}
    </AuthFrame>
  );
}

// ---------------------------------------------------------------------------
// Shared states

function Checking({ title = "One moment", subtitle = "Checking your link…" }: { title?: string; subtitle?: string }) {
  return (
    <AuthFrame title={title} subtitle={subtitle}>
      <View className="items-start py-2">
        <ActivityIndicator colorClassName="accent-primary" />
      </View>
    </AuthFrame>
  );
}

/** Not the link's fault — usually the network. The code may still be good. */
function Failed({ error, retry, onDone }: { error: AuthError; retry: () => void; onDone: () => void }) {
  return (
    <AuthFrame
      title="That didn't go through"
      subtitle={error.message}
      footer={<TextLink label="Back to little by little" onPress={onDone} />}
    >
      <SheetButton label="Try again" icon="refresh" onPress={retry} />
    </AuthFrame>
  );
}

function BrokenLink({ onDone }: { onDone: () => void }) {
  return (
    <AuthFrame
      title="This link doesn't work"
      subtitle="Part of it may be missing — some email apps cut long links short. Open it again from the email, or ask for a new one from little by little."
    >
      <SheetButton label="Go to little by little" onPress={onDone} />
    </AuthFrame>
  );
}

function NotInDevMode({ onDone }: { onDone: () => void }) {
  return (
    <AuthFrame
      eyebrow="Development"
      title="Nothing to do here"
      subtitle="This build signs in without passwords, so it never sends verification or reset emails. Links like this one only work in a build that uses Firebase sign-in."
    >
      <SheetButton label="Go to little by little" onPress={onDone} />
    </AuthFrame>
  );
}
