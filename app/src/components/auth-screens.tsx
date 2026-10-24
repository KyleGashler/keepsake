import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth, AuthError, DEV_DEFAULT_EMAIL } from "../auth";
import { useSession } from "../auth/session-context";
import { Wordmark } from "./brand";
import { Field, SheetButton, SheetError, SheetInput } from "./sheet";

/**
 * The screens before the archive: sign in, create an account, reset a
 * password. They render in place of the app (see app/_layout.tsx), so the
 * URL a person arrived at survives signing in.
 *
 * Calm and plain on purpose — paper, the wordmark, a display-serif title and
 * the sheet's form controls. Nothing here should feel like a dashboard.
 */

export function AuthFrame({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-paper">
      <ScrollView
        contentContainerClassName="grow justify-center px-6"
        contentContainerStyle={{ paddingTop: insets.top + 36, paddingBottom: insets.bottom + 36 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Forms read best narrower than the app's 720pt content column. */}
        <View className="w-full max-w-[440px] self-center">
          {/* Wordmark takes a style, not a className. */}
          <Wordmark width={148} style={{ marginBottom: 36 }} />
          {eyebrow ? <Text className="mb-1 type-eyebrow">{eyebrow}</Text> : null}
          <Text className="font-display text-[40px] leading-[46px] tracking-[-0.5px] text-ink" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text className="mt-2 font-sans text-[16.5px] leading-[23px] text-ink-soft">{subtitle}</Text> : null}
          {children ? <View className="mt-6 gap-4">{children}</View> : null}
          {footer ? <View className="mt-6 items-center">{footer}</View> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const LINK = "font-sans-bold text-[15px] text-ink underline";

/** "New to little by little? Create an account" — a sentence with a tappable end. */
export function TextLink({ lead, label, onPress }: { lead?: string; label: string; onPress: () => void }) {
  return (
    <Text className="text-center font-sans text-[15px] leading-[21px] text-ink-soft">
      {lead ? `${lead} ` : ""}
      <Text onPress={onPress} accessibilityRole="link" className={LINK}>
        {label}
      </Text>
    </Text>
  );
}

function messageOf(err: unknown) {
  if (err instanceof AuthError) return err.message;
  return "Something went wrong. Please try again.";
}

type Step = "signIn" | "signUp" | "forgot";

/**
 * Everything a signed-out person can do, one screen at a time.
 *
 * `startWith` and `context` are for arriving with a purpose (an invite link):
 * which form comes first, and a line shown above it saying why.
 */
export function SignedOutFlow({ startWith = "signIn", context }: { startWith?: "signIn" | "signUp"; context?: string }) {
  const session = useSession();
  const notice = context ?? session.notice;
  const [step, setStep] = useState<Step>(startWith);
  // Carried between steps so "forgot password" doesn't make anyone retype it.
  // An invitee isn't the demo owner, so their form starts empty.
  const [email, setEmail] = useState(auth.mode === "dev" && !context ? DEV_DEFAULT_EMAIL : "");

  if (auth.mode === "dev") return <DevSignIn email={email} setEmail={setEmail} notice={notice} />;
  if (step === "signUp") return <SignUp email={email} setEmail={setEmail} go={setStep} notice={context ?? null} />;
  if (step === "forgot") return <ForgotPassword email={email} setEmail={setEmail} go={setStep} />;
  return <SignIn email={email} setEmail={setEmail} go={setStep} notice={notice} />;
}

type StepProps = {
  email: string;
  setEmail: (email: string) => void;
  go: (step: Step) => void;
};

function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit: () => void submit() };
}

function SignIn({ email, setEmail, go, notice }: StepProps & { notice: string | null }) {
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(() => auth.signIn(email, password));
  const ready = email.trim().length > 0 && password.length > 0;

  return (
    <AuthFrame
      eyebrow="Welcome back"
      title="Sign in"
      subtitle="Your family's stories are right where you left them."
      footer={<TextLink lead="New to little by little?" label="Create an account" onPress={() => go("signUp")} />}
    >
      {notice ? <Notice>{notice}</Notice> : null}
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
          returnKeyType="next"
          accessibilityLabel="Email"
        />
      </Field>
      <Field label="Password">
        <SheetInput
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={ready ? submit : undefined}
          accessibilityLabel="Password"
        />
      </Field>
      <Pressable onPress={() => go("forgot")} hitSlop={8} className="-mt-1 self-start" accessibilityRole="link">
        <Text className={LINK}>Forgot your password?</Text>
      </Pressable>
      <SheetError message={error} />
      <SheetButton label="Sign in" onPress={submit} busy={busy} disabled={!ready} />
    </AuthFrame>
  );
}

function SignUp({ email, setEmail, go, notice }: StepProps & { notice: string | null }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit(() => auth.signUp(email, password, name));
  const ready = email.trim().length > 0 && password.length > 0;

  return (
    <AuthFrame
      eyebrow="Begin"
      title="Create your account"
      subtitle="Start keeping the stories that make your family yours."
      footer={<TextLink lead="Already have an account?" label="Sign in" onPress={() => go("signIn")} />}
    >
      {notice ? <Notice>{notice}</Notice> : null}
      <Field label="Your name" hint="How you'll appear in your family's archive.">
        <SheetInput
          value={name}
          onChangeText={setName}
          placeholder="Ali Bryner"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          maxLength={80}
          accessibilityLabel="Your name"
        />
      </Field>
      <Field label="Email" hint="We'll send a link to confirm it's yours.">
        <SheetInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          accessibilityLabel="Email"
        />
      </Field>
      <Field label="Password" hint="At least 6 characters.">
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
          onSubmitEditing={ready ? submit : undefined}
          accessibilityLabel="Password"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Create account" onPress={submit} busy={busy} disabled={!ready} />
    </AuthFrame>
  );
}

function ForgotPassword({ email, setEmail, go }: StepProps) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit(async () => {
    await auth.sendPasswordReset(email);
    setSentTo(email.trim());
  });

  if (sentTo) {
    return (
      <AuthFrame
        eyebrow="On its way"
        title="Check your inbox"
        subtitle={`If there's a little by little account for ${sentTo}, a link to choose a new password is on its way. It can take a minute or two.`}
      >
        <SheetButton label="Back to sign in" onPress={() => go("signIn")} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      eyebrow="It happens"
      title="Reset your password"
      subtitle="Tell us the email you signed up with and we'll send you a link to choose a new one."
      footer={<TextLink label="Back to sign in" onPress={() => go("signIn")} />}
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
          onSubmitEditing={email.trim() ? submit : undefined}
          accessibilityLabel="Email"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Send reset link" onPress={submit} busy={busy} disabled={!email.trim()} />
    </AuthFrame>
  );
}

/**
 * Dev mode: an email, no password. The API's DevTokenVerifier takes the
 * address at its word; demo@littlebylittle.local opens the seeded family, and any
 * other address starts a new, empty account.
 */
function DevSignIn({
  email,
  setEmail,
  notice,
}: {
  email: string;
  setEmail: (email: string) => void;
  notice: string | null;
}) {
  const { busy, error, submit } = useSubmit(() => auth.signIn(email, ""));
  return (
    <AuthFrame
      eyebrow="Development"
      title="Sign in"
      subtitle="No password in this build — the email is the whole credential. The demo address opens the Bryners; any other starts a new account."
    >
      {notice ? <Notice>{notice}</Notice> : null}
      <Field label="Email">
        <SheetInput
          value={email}
          onChangeText={setEmail}
          placeholder={DEV_DEFAULT_EMAIL}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          returnKeyType="go"
          onSubmitEditing={email.trim() ? submit : undefined}
          accessibilityLabel="Email"
        />
      </Field>
      <SheetError message={error} />
      <SheetButton label="Sign in" onPress={submit} busy={busy} disabled={!email.trim()} />
    </AuthFrame>
  );
}

/** A quiet panel for something the person should know but didn't do wrong. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-[12px] bg-accent-soft p-3">
      <Text className="font-sans text-[14.5px] leading-[20px] text-ink">{children}</Text>
    </View>
  );
}
