import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { AuthError } from "../auth";
import { useSession } from "../auth/session-context";
import { ROLE_LABEL } from "../roles";
import { SUPPORT_EMAIL } from "../support";
import { colors, fonts, radius, spacing, type } from "../theme";
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
    <View style={styles.splash} accessibilityLabel="Opening little by little">
      <BrandMark size={64} />
      <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
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
              <View style={styles.familyDisc}>
                <Ionicons name="people-outline" size={22} color={colors.ink} />
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
    <View style={styles.nudge} accessibilityRole="summary">
      <View style={styles.nudgeHeader}>
        <Ionicons name="mail-unread-outline" size={20} color={colors.accentDeep} />
        <Text style={styles.nudgeTitle}>Verify your email</Text>
        <Pressable onPress={dismissVerifyNudge} hitSlop={10} accessibilityLabel="Dismiss" style={styles.nudgeClose}>
          <Ionicons name="close" size={18} color={colors.inkSoft} />
        </Pressable>
      </View>
      <Text style={styles.nudgeBody}>
        We sent a link to {user.email}. You'll need it verified to join another family's archive by invitation.
      </Text>
      {message ? <Text style={styles.nudgeStatus}>{message}</Text> : null}
      {error ? <Text style={[styles.nudgeStatus, { color: colors.terracotta }]}>{error}</Text> : null}
      <View style={styles.nudgeActions}>
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
  const fg = primary ? colors.onPrimary : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.nudgeButton,
        primary ? { backgroundColor: colors.primary } : styles.nudgeButtonSecondary,
        disabled && !busy && { opacity: 0.5 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={[styles.nudgeButtonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  familyDisc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  nudge: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    gap: spacing.sm,
  },
  nudgeHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nudgeTitle: { flex: 1, fontFamily: fonts.display, fontSize: 19, lineHeight: 24, color: colors.ink },
  nudgeClose: { padding: 2 },
  nudgeBody: { ...type.body, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  nudgeStatus: { ...type.caption, color: colors.inkSoft },
  nudgeActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  nudgeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  nudgeButtonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  nudgeButtonLabel: { fontFamily: fonts.sansBold, fontSize: 14 },
});
