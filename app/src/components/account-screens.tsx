import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AuthError } from "../auth";
import { useSession } from "../auth/session-context";
import { ROLE_LABEL } from "../roles";
import { Ionicons } from "../styled";
import { SUPPORT_EMAIL } from "../support";
import { AuthFrame, Notice, TextLink } from "./auth-screens";
import { BrandMark } from "./brand";
import { ListRow } from "./journey";
import { Field, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * The screens between signing in and the archive: the splash while the
 * account loads, the verify-email and account-problem states, and creating or
 * choosing a family. Each is one phase of the session (src/auth/session.tsx).
 */

/**
 * What shows while the session restores and `GET /me` answers. The native
 * splash is the same paper colour (app.json), so the hand-off is seamless;
 * on the web this is the first thing drawn.
 */
export function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-paper" accessibilityLabel="Opening little by little">
      <BrandMark size={64} />
      <ActivityIndicator colorClassName="accent-primary" className="mt-6" />
    </View>
  );
}

function errorText(err: unknown) {
  if (err instanceof AuthError) return err.message;
  return "Something went wrong. Please try again.";
}

/** "Signed in as ali@example.com · Sign out" — at the foot of every account screen. */
function SignedInAs() {
  const { user, signOut } = useSession();
  return <TextLink lead={user ? `Signed in as ${user.email}.` : undefined} label="Sign out" onPress={() => void signOut()} />;
}

/** Resend + "I've verified", shared by the blocking screen and the Family Hub nudge. */
function useVerifyActions() {
  const { resendVerification, confirmVerified } = useSession();
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (which: "resend" | "check") => {
    setBusy(which);
    setMessage(null);
    setError(null);
    try {
      if (which === "resend") {
        await resendVerification();
        setMessage("Sent. The link can take a minute or two to arrive — check spam if it doesn't.");
      } else if (!(await confirmVerified())) {
        setError("Not verified yet. Follow the link in the email, then try again.");
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, message, error, resend: () => void run("resend"), check: () => void run("check") };
}

/**
 * The API won't let this sign-in take over an existing account until the
 * address is proven (403 verify_email). Verifying is the only way forward.
 */
export function VerifyEmailScreen() {
  const { user } = useSession();
  const { busy, message, error, resend, check } = useVerifyActions();
  return (
    <AuthFrame
      eyebrow="One more step"
      title="Verify your email"
      subtitle={`There's already a little by little archive for ${user?.email ?? "this address"}. Follow the link we emailed you so we know it's yours, then come back here.`}
      footer={<SignedInAs />}
    >
      {message ? <Notice>{message}</Notice> : null}
      <SheetError message={error} />
      <SheetButton label="I've verified" onPress={check} busy={busy === "check"} disabled={busy !== null} />
      <SheetButton
        label="Send the email again"
        variant="secondary"
        onPress={resend}
        busy={busy === "resend"}
        disabled={busy !== null}
      />
    </AuthFrame>
  );
}

/** 409 email_in_use: a different account owns this address. Nothing to do here but leave. */
export function EmailInUseScreen() {
  const { user, signOut } = useSession();
  return (
    <AuthFrame
      title="This email is taken"
      subtitle={`Another little by little account already uses ${user?.email ?? "this address"}. Sign in with that account instead, or write to ${SUPPORT_EMAIL} and we'll sort it out.`}
    >
      <SheetButton label="Sign out" onPress={() => void signOut()} />
    </AuthFrame>
  );
}

/** `GET /me` failed for a reason that isn't about the account — usually the network. */
export function AccountErrorScreen() {
  const { accountError, refreshAccount } = useSession();
  const offline = accountError && /failed to fetch|network/i.test(accountError.message);
  return (
    <AuthFrame
      title="Can't reach the archive"
      subtitle={
        offline
          ? "Check your connection and try again."
          : "The archive couldn't answer just now. Try again in a moment."
      }
      footer={<SignedInAs />}
    >
      <SheetButton label="Try again" icon="refresh" onPress={() => void refreshAccount()} />
    </AuthFrame>
  );
}

/** Signed in, belongs to no family yet: start one. */
export function CreateFamilyScreen() {
  const { me, createFamily } = useSession();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(me?.user.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createFamily(name.trim(), displayName.trim() || undefined);
    } catch {
      setError("Couldn't create the archive just now. Please try again.");
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      eyebrow="Welcome"
      title="Start your family's archive"
      subtitle="Give it a name — the one you'd write on the front of a photo album. You can invite everyone else once it exists."
      footer={<SignedInAs />}
    >
      <Field label="Family name">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="The Reyes family"
          autoCapitalize="words"
          maxLength={80}
          returnKeyType="next"
          accessibilityLabel="Family name"
        />
      </Field>
      <Field label="Your name" hint="How you'll appear in the archive.">
        <SheetInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          autoCapitalize="words"
          autoComplete="name"
          maxLength={80}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          accessibilityLabel="Your name"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Create the archive" onPress={() => void submit()} busy={busy} disabled={!name.trim()} />
    </AuthFrame>
  );
}

/** In several families and no remembered choice: pick one. Remembered next time. */
export function ChooseFamilyScreen() {
  const { memberships, selectFamily } = useSession();
  return (
    <AuthFrame
      eyebrow="Welcome back"
      title="Which archive?"
      subtitle="You belong to more than one family. To switch later, tap the family name at the top of Home."
      footer={<SignedInAs />}
    >
      <View>
        {memberships.map((m, i) => (
          <ListRow
            key={m.familyId}
            title={m.familyName}
            description={ROLE_LABEL[m.role]}
            leading={
              <View className="h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                <Ionicons name="people-outline" size={22} colorClassName="accent-ink" />
              </View>
            }
            onPress={() => selectFamily(m.familyId)}
            divider={i < memberships.length - 1}
          />
        ))}
      </View>
    </AuthFrame>
  );
}

/**
 * The join screen's verify step: accepting an invite needs a verified email
 * (the API answers `403 verify_email` otherwise), so this stands where the
 * Join button would.
 */
export function VerifyToJoin() {
  const { user } = useSession();
  const { busy, message, error, resend, check } = useVerifyActions();
  return (
    <>
      <Notice>
        To join, verify your email first: follow the link we sent to {user?.email ?? "your address"}, then come back
        here.
      </Notice>
      {message ? <Notice>{message}</Notice> : null}
      <SheetError message={error} />
      <SheetButton label="I've verified" onPress={check} busy={busy === "check"} disabled={busy !== null} />
      <SheetButton
        label="Send the email again"
        variant="secondary"
        onPress={resend}
        busy={busy === "resend"}
        disabled={busy !== null}
      />
    </>
  );
}

/**
 * Family Hub's gentle reminder: signed up, not yet verified. Never blocks
 * anything here; accepting an invite to another family needs it.
 */
export function VerifyEmailNudge() {
  const { user, verifyNudgeDismissed, dismissVerifyNudge } = useSession();
  const { busy, message, error, resend, check } = useVerifyActions();
  if (!user || user.emailVerified || verifyNudgeDismissed) return null;

  return (
    <View className="mb-4 gap-2 rounded-md bg-accent-soft p-4" accessibilityRole="summary">
      <View className="flex-row items-center gap-2">
        <Ionicons name="mail-unread-outline" size={20} colorClassName="accent-accent-deep" />
        <Text className="flex-1 font-display text-[19px] leading-[24px] text-ink">Verify your email</Text>
        <Pressable onPress={dismissVerifyNudge} hitSlop={10} accessibilityLabel="Dismiss" className="p-0.5">
          <Ionicons name="close" size={18} colorClassName="accent-ink-soft" />
        </Pressable>
      </View>
      <Text className="font-sans text-[14.5px] leading-[21px] text-ink">
        We sent a link to {user.email}. You'll need it verified to join another family's archive by invitation.
      </Text>
      {message ? <Text className="type-caption text-ink-soft">{message}</Text> : null}
      {error ? <Text className="type-caption text-terracotta">{error}</Text> : null}
      <View className="mt-1 flex-row gap-2">
        <NudgeButton label="I've verified" onPress={check} busy={busy === "check"} disabled={busy !== null} primary />
        <NudgeButton label="Resend" onPress={resend} busy={busy === "resend"} disabled={busy !== null} />
      </View>
    </View>
  );
}

function NudgeButton({
  label,
  onPress,
  busy,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`flex-row items-center gap-1 rounded-full px-4 py-[9px] active:opacity-70 ${
        primary ? "bg-primary" : "border border-line bg-surface"
      } ${disabled && !busy ? "opacity-50" : ""}`}
    >
      {busy ? (
        <ActivityIndicator size="small" colorClassName={primary ? "accent-on-primary" : "accent-ink"} />
      ) : null}
      <Text className={`font-sans-bold text-[14px] ${primary ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
