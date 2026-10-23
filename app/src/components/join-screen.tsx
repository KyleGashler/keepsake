import { useState, type ReactNode } from "react";
import { ApiError, isNotFound, useApi, type InvitePreview } from "../api";
import { useSession } from "../auth/session-context";
import { friendlyError } from "../format";
import { ROLE_DESCRIPTION } from "../roles";
import { Splash, VerifyToJoin } from "./account-screens";
import { AuthFrame, Notice, SignedOutFlow, TextLink } from "./auth-screens";
import { SheetButton, SheetError } from "./sheet";

/**
 * Where an invite link lands: `/join/<token>`. The root layout draws this in
 * place of the usual phase screen — signed out, signed in with no family, or
 * in an archive already — so the link works from wherever someone is, and
 * nobody is walked through creating a family they don't want first.
 *
 * Preview (public: who's inviting you to what) → sign up or in → verify the
 * email → Join, which switches into the family. `onDone` hands back to the
 * usual phase screen: after joining that's the archive; "Not now" leaves the
 * person wherever they would otherwise have been.
 */
export function JoinScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const session = useSession();
  const { data, error, refetch } = useApi<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}`);
  const [signingIn, setSigningIn] = useState<"signIn" | "signUp" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (session.phase === "restoring" || session.phase === "loadingAccount") return <Splash />;

  if (error) {
    return isNotFound(error) ? (
      <Unusable title="This invite link doesn't work" body="Check you have the whole link, or ask for a new one." onDone={onDone} />
    ) : (
      <AuthFrame title="Can't open this invite" subtitle="The archive couldn't answer just now.">
        <SheetButton label="Try again" icon="refresh" onPress={() => void refetch()} />
        <TextLink label="Not now" onPress={onDone} />
      </AuthFrame>
    );
  }
  if (!data) return <Splash />;
  const invite = data.invite;

  if (invite.status !== "valid") {
    const body: Record<Exclude<InvitePreview["status"], "valid">, string> = {
      expired: `Invite links last a week. Ask ${invite.inviterName} to send you a new one.`,
      used: `Someone has already joined with this link. If that wasn't you, ask ${invite.inviterName} for a new one.`,
      revoked: `${invite.inviterName} withdrew this invitation. Ask them if you think that's a mistake.`,
    };
    const title = { expired: "This invite has expired", used: "This invite has been used", revoked: "This invite was withdrawn" };
    return <Unusable title={title[invite.status]} body={body[invite.status]} onDone={onDone} />;
  }

  const joining = `Join ${invite.familyName} on little by little`;

  if (session.phase === "signedOut") {
    if (signingIn) {
      return <SignedOutFlow startWith={signingIn} context={`Sign in or create an account to join ${invite.familyName}.`} />;
    }
    return (
      <Invitation invite={invite} footer={<TextLink label="Not now" onPress={onDone} />}>
        <SheetButton label="Create an account" onPress={() => setSigningIn("signUp")} />
        <SheetButton label="I already have an account" variant="secondary" onPress={() => setSigningIn("signIn")} />
      </Invitation>
    );
  }

  const accept = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await session.acceptInvite(token);
      onDone();
    } catch (err) {
      setBusy(false);
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "expired" || code === "used" || code === "revoked") return void refetch();
      if (code === "verify_email") {
        setProblem("The archive doesn't see your email as verified yet. Tap \"I've verified\" below, then try again.");
      } else if (code === "person_taken") {
        setProblem(
          `Someone has already joined as ${invite.forName ?? "the person this invite is for"}. Ask ${invite.inviterName} for a new invite.`,
        );
      } else {
        setProblem(friendlyError(err, "Couldn't join just now. Please try again."));
      }
    }
  };

  const footer = (
    <>
      <TextLink
        lead={session.user ? `Signed in as ${session.user.email}.` : undefined}
        label="Not you? Sign out"
        onPress={() => void session.signOut()}
      />
      <TextLink label="Not now" onPress={onDone} />
    </>
  );

  return (
    <Invitation invite={invite} footer={footer}>
      {session.user && !session.user.emailVerified ? (
        <VerifyToJoin />
      ) : (
        <>
          <SheetError message={problem} />
          <SheetButton label={joining} onPress={() => void accept()} busy={busy} />
        </>
      )}
    </Invitation>
  );
}

/** The invitation itself: who, to what, as what. */
function Invitation({
  invite,
  children,
  footer,
}: {
  invite: InvitePreview;
  children: ReactNode;
  footer: ReactNode;
}) {
  const who = invite.forName ? `${invite.forName}, ${invite.inviterName}` : invite.inviterName;
  return (
    <AuthFrame
      eyebrow="You're invited"
      title={invite.familyName}
      subtitle={`${who} invited you to the family's archive on little by little.`}
      footer={footer}
    >
      <Notice>{ROLE_DESCRIPTION[invite.role]}</Notice>
      {children}
    </AuthFrame>
  );
}

function Unusable({ title, body, onDone }: { title: string; body: string; onDone: () => void }) {
  return (
    <AuthFrame title={title} subtitle={body}>
      <SheetButton label="Continue" onPress={onDone} />
    </AuthFrame>
  );
}
