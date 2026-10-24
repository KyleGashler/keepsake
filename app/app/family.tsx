import type { Ionicons as BaseIonicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  ApiError,
  apiSend,
  isForbiddenRole,
  useApi,
  type FamilyMember,
  type FamilyPayload,
  type FamilyPerson,
  type Invite,
  type InviteCreate,
  type MembershipRole,
} from "../src/api";
import { useSession } from "../src/auth/session-context";
import { VerifyEmailNudge } from "../src/components/account-screens";
import { DeleteAccountSheet, DeleteFamilySheet } from "../src/components/deletion-sheets";
import { FamilySwitchSheet } from "../src/components/family-switcher";
import { AddPersonSheet } from "../src/components/person-sheets";
import { ActionSheet, Field, Sheet, SheetButton, SheetError, SheetInput, type SheetAction } from "../src/components/sheet";
import {
  AppHeader,
  Avatar,
  ErrorState,
  Loading,
  PreviewNote,
  Screen,
  SectionHeader,
  SmallButton,
} from "../src/components/ui";
import { friendlyError, monthDay } from "../src/format";
import { leaveFor } from "../src/routes";
import { INVITE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from "../src/roles";
import { canCopy, copyLink, shareLink } from "../src/share-link";
import { Ionicons } from "../src/styled";
import { SUPPORT_EMAIL } from "../src/support";

const SETTINGS = [
  { icon: "lock-closed-outline" as const, label: "Privacy & ownership", detail: "Your family owns every memory" },
  { icon: "card-outline" as const, label: "Subscription", detail: "Not billed in this build" },
  { icon: "download-outline" as const, label: "Downloading", detail: "Per memory: open one, then ⋯ → Download" },
  { icon: "help-circle-outline" as const, label: "Support", detail: SUPPORT_EMAIL },
];

/**
 * Family Hub is administrative rather than emotional, which is why it's a modal
 * instead of a permanent destination.
 *
 * Who's here comes from the family's memberships, each with its role. An owner
 * also sees the invite form, the pending invites and the member controls;
 * everyone else sees who's here and what they can do — the API refuses the
 * rest anyway (`403 forbidden_role`).
 */
export default function FamilyHubScreen() {
  const { data, error, loading, refetch } = useApi<FamilyPayload>("/api/family");
  // Back from a person's page (edited, deleted, just added): show what's true
  // now. Only on a return — the first focus is the mount, already fetched.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) void refetchRef.current();
      focusedBefore.current = true;
    }, []),
  );
  const isOwner = data?.role === "OWNER";
  const pending = useApi<{ invites: Invite[] }>(isOwner ? "/api/family/invites" : null);
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const [inviting, setInviting] = useState<{ personId?: string } | null>(null);
  const [managing, setManaging] = useState<FamilyMember | null>(null);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);
  const [inviteActions, setInviteActions] = useState<Invite | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  // Home's "Invite" links here with ?invite=1, which opens the invite sheet.
  const linkedInvite = useLocalSearchParams<{ invite?: string }>().invite;
  const openInvite = inviting ?? (linkedInvite && isOwner ? {} : null);
  const closeInvite = () => {
    setInviting(null);
    if (linkedInvite) router.setParams({ invite: undefined });
  };
  const [deleting, setDeleting] = useState<"family" | "account" | null>(null);
  const [notice, setNotice] = useState<HubNotice | null>(null);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading label="Opening Family Hub…" />;
  if (!data) return null;

  const invitable = data.people.filter((p) => p.invitable);
  // Adding (and, on their page, editing or deleting) people is contributors' work.
  const canContribute = data.role !== "VIEWER";
  const refreshAll = async () => {
    await Promise.all([refetch(), isOwner ? pending.refetch() : Promise.resolve()]);
  };

  /** Do `work`, say what went wrong if it did (under `section`); true when it worked. */
  const attempt = async (section: HubNotice["section"], work: () => Promise<unknown>, fallback: string) => {
    setNotice(null);
    try {
      await work();
      return true;
    } catch (err) {
      setNotice({ section, text: hubError(err, fallback) });
      return false;
    }
  };

  const setRole = async (member: FamilyMember, role: MembershipRole) => {
    const ok = await attempt(
      "members",
      () => apiSend(`/api/family/members/${member.userId}`, "PATCH", { role }),
      "Couldn't change their role just now.",
    );
    // Your own role changed: what the app lets you do changes with it.
    if (ok && member.isYou) await session.refreshAccount();
    await refreshAll();
  };

  const remove = async (member: FamilyMember) => {
    const ok = await attempt(
      "members",
      () => apiSend(`/api/family/members/${member.userId}`, "DELETE"),
      "Couldn't remove them just now.",
    );
    // You left (another owner remains): this family is no longer yours to look at.
    if (ok && member.isYou) return leaveFor(() => void session.refreshAccount());
    await refreshAll();
  };

  const withdraw = async (invite: Invite) => {
    await attempt(
      "invites",
      () => apiSend(`/api/family/invites/${invite.id}`, "DELETE"),
      "Couldn't withdraw it just now.",
    );
    await refreshAll();
  };

  const passOn = async (invite: Invite) => {
    const result = await shareLink(invite.url, inviteMessage(data.family.name));
    if (result === "copied") setNotice({ section: "invites", text: "Invite link copied." });
  };

  const memberPress = (member: FamilyMember) => {
    if (isOwner) return () => setManaging(member);
    const person = member.person;
    return person ? () => router.push(`/person/${person.id}`) : undefined;
  };

  const memberActions = (member: FamilyMember): SheetAction[] => [
    ...INVITE_ROLES.filter((role) => role !== member.role).map((role) => ({
      label: `Change to “${ROLE_LABEL[role]}”`,
      icon: ROLE_ICON[role],
      onPress: () => void setRole(member, role),
    })),
    ...(member.person
      ? [
          {
            label: "See their memories",
            icon: "person-outline" as const,
            onPress: () => router.push(`/person/${member.person?.id}`),
          },
        ]
      : []),
    {
      label: member.isYou ? "Leave this family" : "Remove from the family",
      icon: "person-remove-outline",
      destructive: true,
      onPress: () => setRemoving(member),
    },
  ];

  return (
    <>
      <AppHeader back mark subtitle="Family Hub" title={data.family.name} globalActions={false} />
      <Screen>
        <VerifyEmailNudge />

        <View className="flex-row gap-2">
          <Stat value={data.stats.memoryCount} label="Memories" />
          <Stat value={data.stats.mediaCount} label="Media" />
          <Stat value={data.stats.collectionCount} label="Collections" />
          <Stat value={data.stats.personCount} label="People" />
        </View>

        <SectionHeader
          label="Members"
          action={isOwner ? <SmallButton label="Invite" icon="add" filled onPress={() => setInviting({})} /> : null}
        />
        <Notice notice={notice} section="members" />
        <Group>
          {data.members.map((member, i) => (
            <Row
              key={member.userId}
              first={i === 0}
              leading={member.person ? <Avatar person={member.person} size={LEADING} /> : <Initials name={member.name} />}
              title={`${member.name}${member.isYou ? " (you)" : ""}${member.person?.relation ? ` · ${member.person.relation}` : ""}`}
              detail={`${member.permission}${member.email ? ` · ${member.email}` : ""}`}
              trailing={<RowIcon name={isOwner ? "ellipsis-horizontal" : "chevron-forward"} />}
              onPress={memberPress(member)}
            />
          ))}
        </Group>
        {isOwner && data.members.length === 1 && !pending.data?.invites.length ? (
          <Text className={GROUP_HINT}>
            Invite a grandparent, an aunt, a co-parent — anyone who should see the archive.
          </Text>
        ) : null}

        {isOwner && pending.data?.invites.length ? (
          <>
            <SectionHeader label="Waiting to join" />
            <Notice notice={notice} section="invites" />
            <Group>
              {pending.data.invites.map((invite, i) => (
                <Row
                  key={invite.id}
                  first={i === 0}
                  leading={<LeadingIcon name="mail-outline" tintClassName="bg-accent-soft" />}
                  title={invite.forName ?? "Anyone with the link"}
                  detail={`${ROLE_LABEL[invite.role]} · until ${monthDay(invite.expiresAt)}${invite.email ? ` · ${invite.email}` : ""}`}
                  trailing={<RowIcon name="ellipsis-horizontal" />}
                  onPress={() => setInviteActions(invite)}
                />
              ))}
            </Group>
          </>
        ) : null}

        <OthersSection
          people={data.people}
          isOwner={isOwner}
          canContribute={canContribute}
          onAdd={() => setAddingPerson(true)}
          onInvite={(personId) => setInviting({ personId })}
        />

        <SectionHeader label="Settings" />
        <Group>
          {SETTINGS.map((setting, i) => (
            <Row
              key={setting.label}
              first={i === 0}
              leading={<LeadingIcon name={setting.icon} />}
              title={setting.label}
              detail={setting.detail}
            />
          ))}
        </Group>

        {isOwner ? (
          <>
            <SectionHeader label="This family" />
            <Group>
              <Row
                first
                leading={<LeadingIcon name="trash-outline" colorClassName="accent-danger" />}
                title="Delete this family"
                detail="For everyone in it, with every memory"
                destructive
                trailing={<RowIcon name="chevron-forward" />}
                onPress={() => setDeleting("family")}
              />
            </Group>
          </>
        ) : null}

        <AccountSection
          role={data.role}
          onSwitch={() => setSwitching(true)}
          onDeleteAccount={() => setDeleting("account")}
        />

        <PreviewNote>Billing isn't set up in this build yet.</PreviewNote>

        <FamilySwitchSheet visible={switching} onClose={() => setSwitching(false)} />

        <ActionSheet
          visible={managing !== null}
          onClose={() => setManaging(null)}
          title={managing?.name ?? ""}
          subtitle={managing ? ROLE_DESCRIPTION[managing.role] : undefined}
          actions={managing ? memberActions(managing) : []}
        />

        <ActionSheet
          visible={removing !== null}
          onClose={() => setRemoving(null)}
          title={removing?.isYou ? "Leave this family?" : `Remove ${removing?.name ?? ""}?`}
          subtitle={
            removing?.isYou
              ? "You'll lose access to this archive. What you added stays in it."
              : "They'll lose access to the archive. What they added stays, and so do they — as someone in it, without an account."
          }
          actions={
            removing
              ? [
                  {
                    label: removing.isYou ? "Leave" : "Remove",
                    icon: "person-remove-outline",
                    destructive: true,
                    onPress: () => void remove(removing),
                  },
                ]
              : []
          }
        />

        <ActionSheet
          visible={inviteActions !== null}
          onClose={() => setInviteActions(null)}
          title={inviteActions?.forName ? `Invite for ${inviteActions.forName}` : "Invite link"}
          subtitle={inviteActions ? `${ROLE_LABEL[inviteActions.role]} · until ${monthDay(inviteActions.expiresAt)}` : undefined}
          actions={
            inviteActions
              ? [
                  ...(canCopy
                    ? [
                        {
                          label: "Copy the link",
                          icon: "copy-outline" as const,
                          onPress: () =>
                            void copyLink(inviteActions.url).then((r) => {
                              if (r === "copied") setNotice({ section: "invites", text: "Invite link copied." });
                            }),
                        },
                      ]
                    : []),
                  { label: "Share the link", icon: "share-outline", onPress: () => void passOn(inviteActions) },
                  {
                    label: "Withdraw the invite",
                    icon: "close-circle-outline",
                    destructive: true,
                    onPress: () => void withdraw(inviteActions),
                  },
                ]
              : []
          }
        />

        {addingPerson ? (
          <AddPersonSheet
            onClose={() => setAddingPerson(false)}
            onAdded={(person) => {
              void refetch();
              router.push(`/person/${person.id}`);
            }}
          />
        ) : null}

        {deleting === "family" ? (
          <DeleteFamilySheet
            familyName={data.family.name}
            stats={data.stats}
            memberCount={data.members.length}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              const gone = data.family.id;
              leaveFor(() => void session.familyGone(gone));
            }}
          />
        ) : null}

        {deleting === "account" ? <DeleteAccountSheet onClose={() => setDeleting(null)} /> : null}

        {openInvite ? (
          <InviteSheet
            familyName={data.family.name}
            people={invitable}
            initialPersonId={openInvite.personId}
            onClose={closeInvite}
            onCreated={() => void refreshAll()}
          />
        ) : null}
      </Screen>
    </>
  );
}

const ROLE_ICON: Record<MembershipRole, keyof typeof BaseIonicons.glyphMap> = {
  OWNER: "key-outline",
  CONTRIBUTOR: "create-outline",
  VIEWER: "eye-outline",
};

/** The API's refusals here, in words. Anything else gets `fallback`. */
const HUB_ERRORS: Record<string, string> = {
  last_owner: "A family needs at least one owner. Make someone else an owner first.",
  used: "That invite has already been used.",
  revoked: "That invite was already withdrawn.",
  person_linked: "They've already joined, so there's no need to invite them.",
  child_person: "Children are part of the archive, but don't get their own accounts.",
};

function hubError(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.code) return HUB_ERRORS[err.code] ?? (isForbiddenRole(err) ? err.message : fallback);
  return friendlyError(err, fallback);
}

function inviteMessage(familyName: string) {
  return `Join ${familyName} on little by little:`;
}

/**
 * "Also in the archive": children, and adults without an account. Each opens
 * their page (where a contributor edits or deletes them); an owner can invite
 * an adult from here, and a contributor can add someone new.
 */
function OthersSection({
  people,
  isOwner,
  canContribute,
  onAdd,
  onInvite,
}: {
  people: FamilyPerson[];
  isOwner: boolean;
  canContribute: boolean;
  onAdd: () => void;
  onInvite: (personId: string) => void;
}) {
  if (people.length === 0 && !canContribute) return null;
  return (
    <>
      <SectionHeader
        label="Also in the archive"
        action={canContribute ? <SmallButton label="Add" icon="add" onPress={onAdd} /> : null}
      />
      {people.length === 0 ? (
        <Text className={GROUP_HINT}>
          Add someone who belongs in the family's story but won't sign in — a great-grandparent, an aunt abroad.
        </Text>
      ) : (
        <Group>
          {people.map((person, i) => (
            <Row
              key={person.id}
              first={i === 0}
              leading={<Avatar person={person} size={LEADING} />}
              title={`${person.name}${person.relation ? ` · ${person.relation}` : ""}`}
              detail={person.role === "CHILD" ? "Child" : "No account yet"}
              trailing={
                isOwner && person.invitable ? (
                  <SmallButton
                    label="Invite"
                    accessibilityLabel={`Invite ${person.name}`}
                    onPress={() => onInvite(person.id)}
                  />
                ) : (
                  <RowIcon name="chevron-forward" />
                )
              }
              onPress={() => router.push(`/person/${person.id}`)}
            />
          ))}
        </Group>
      )}
    </>
  );
}

/**
 * Who's signed in, and the way out: switch family, sign out, and — for an
 * owner of any family — delete the account (A16). Anyone else is told who
 * can, and where to write instead.
 */
function AccountSection({
  role,
  onSwitch,
  onDeleteAccount,
}: {
  role: MembershipRole;
  onSwitch: () => void;
  onDeleteAccount: () => void;
}) {
  const session = useSession();
  const ownsAFamily = session.memberships.some((m) => m.role === "OWNER");
  return (
    <>
      <SectionHeader label="Account" />
      <Group>
        <Row
          first
          leading={<LeadingIcon name="person-circle-outline" />}
          title="Signed in"
          detail={`${session.user?.email ?? ""} · ${ROLE_LABEL[role]}`}
        />
        {session.memberships.length > 1 ? (
          <Row
            leading={<LeadingIcon name="swap-horizontal-outline" />}
            title="Switch family"
            detail={`You belong to ${session.memberships.length} archives`}
            trailing={<RowIcon name="chevron-forward" />}
            onPress={onSwitch}
          />
        ) : null}
        <Row
          leading={<LeadingIcon name="log-out-outline" colorClassName="accent-terracotta" />}
          title="Sign out"
          destructive
          onPress={() => leaveFor(() => void session.signOut())}
        />
        {ownsAFamily ? (
          <Row
            leading={<LeadingIcon name="trash-outline" colorClassName="accent-danger" />}
            title="Delete account"
            detail="For good, with every family you own"
            destructive
            trailing={<RowIcon name="chevron-forward" />}
            onPress={onDeleteAccount}
          />
        ) : null}
      </Group>
      {ownsAFamily ? null : (
        <Text className={GROUP_HINT}>
          Only a family's owner can delete their account. To delete yours, write to {SUPPORT_EMAIL}.
        </Text>
      )}
    </>
  );
}

/** Every row's leading disc, so text lines up down the whole screen. `DISC` is the same size. */
const LEADING = 40;
const DISC = "h-10 w-10 items-center justify-center rounded-full";

const GROUP_HINT = "mt-2 px-1 type-caption";
const ROW_TITLE = "font-sans-semibold text-[15.5px] leading-[21px]";

type HubNotice = { section: "members" | "invites"; text: string };

/** What just happened (or went wrong), shown at the top of the section it happened in. */
function Notice({ notice, section }: { notice: HubNotice | null; section: HubNotice["section"] }) {
  if (notice?.section !== section) return null;
  return <Text className="mb-2 type-caption text-accent-deep">{notice.text}</Text>;
}

/** A white card of `Row`s. */
function Group({ children }: { children: ReactNode }) {
  return <View className="overflow-hidden rounded-md border border-line bg-surface">{children}</View>;
}

function Row({
  leading,
  title,
  detail,
  trailing,
  onPress,
  destructive = false,
  first = false,
}: {
  /** The top row of its group: no hairline above it. */
  first?: boolean;
  leading: ReactNode;
  title: string;
  detail?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-surface-alt"
    >
      {first ? null : (
        // Between rows, starting under the text — past the row's padding, the leading disc and the gap.
        <View
          className="absolute top-0 right-0 bg-line"
          style={{ left: 16 + LEADING + 12, height: StyleSheet.hairlineWidth }}
        />
      )}
      {leading}
      <View className="flex-1">
        <Text className={`${ROW_TITLE} ${destructive ? "text-terracotta" : "text-ink"}`} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text className="type-caption" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

function RowIcon({ name }: { name: keyof typeof BaseIonicons.glyphMap }) {
  return <Ionicons name={name} size={18} colorClassName="accent-muted" />;
}

function LeadingIcon({
  name,
  colorClassName = "accent-ink-soft",
  tintClassName = "bg-surface-alt",
}: {
  name: keyof typeof BaseIonicons.glyphMap;
  /** An `accent-*` class for the glyph. */
  colorClassName?: string;
  /** A `bg-*` class for the disc. */
  tintClassName?: string;
}) {
  return (
    <View className={`${DISC} ${tintClassName}`}>
      <Ionicons name={name} size={19} colorClassName={colorClassName} />
    </View>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <View className={`${DISC} bg-surface-alt`}>
      <Text className="font-sans-bold text-[14px] text-ink-soft">{initials}</Text>
    </View>
  );
}

/**
 * Make an invite: who it's for (someone already in the archive, or someone
 * new), what they'll be able to do, and optionally an address to email it to.
 * Then the link itself, to share however the family talks to each other.
 */
function InviteSheet({
  familyName,
  people,
  initialPersonId,
  onClose,
  onCreated,
}: {
  familyName: string;
  people: FamilyPerson[];
  initialPersonId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  // "new" is someone not in the archive yet; otherwise a Person's id.
  const [who, setWho] = useState<string>(initialPersonId ?? "new");
  const [name, setName] = useState("");
  const [role, setRole] = useState<MembershipRole>("CONTRIBUTOR");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ invite: Invite; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    const body: InviteCreate = { role };
    if (who !== "new") body.personId = who;
    else if (name.trim()) body.name = name.trim();
    if (email.trim()) body.email = email.trim();
    try {
      setCreated(await apiSend<{ invite: Invite; emailed: boolean }>("/api/family/invites", "POST", body));
      onCreated();
    } catch (err) {
      setError(hubError(err, "Couldn't make the invite just now. Check the email address and try again."));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    const { invite, emailed } = created;
    return (
      <Sheet
        visible
        onClose={onClose}
        title="Invite ready"
        subtitle={`${invite.forName ? `For ${invite.forName}. ` : ""}Works once, until ${monthDay(invite.expiresAt)}.`}
        footer={
          <>
            {canCopy ? (
              <SheetButton
                label={copied ? "Copied" : "Copy the link"}
                icon={copied ? "checkmark" : "copy-outline"}
                onPress={() =>
                  void copyLink(invite.url).then((r) => {
                    if (r === "copied") setCopied(true);
                  })
                }
              />
            ) : null}
            <SheetButton
              label="Share the link"
              icon="share-outline"
              variant={canCopy ? "secondary" : "primary"}
              onPress={() =>
                void shareLink(invite.url, inviteMessage(familyName)).then((r) => {
                  if (r === "copied") setCopied(true);
                })
              }
            />
          </>
        }
      >
        <View className="rounded-sm bg-surface-alt p-3">
          <Text selectable className="font-sans text-[14px] text-ink">
            {invite.url}
          </Text>
        </View>
        {invite.email ? (
          <Text className="type-caption">
            {emailed
              ? `We've also emailed it to ${invite.email}.`
              : `It wasn't emailed to ${invite.email} — share it yourself.`}
          </Text>
        ) : null}
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Invite someone"
      subtitle={`A link to join ${familyName}. It works once and lasts a week.`}
      footer={<SheetButton label="Create the link" onPress={() => void create()} busy={busy} />}
    >
      {/* Only worth asking when there's someone in the archive to pick. */}
      {people.length ? (
        <Field label="Who is this?">
          <View className="flex-row flex-wrap gap-2">
            {people.map((p) => (
              <Chip key={p.id} label={p.name} selected={who === p.id} onPress={() => setWho(p.id)} />
            ))}
            <Chip label="Someone new" selected={who === "new"} onPress={() => setWho("new")} />
          </View>
        </Field>
      ) : null}
      {who === "new" ? (
        <Field label="Their name" hint="Leave it empty to use the name on their account.">
          <SheetInput
            value={name}
            onChangeText={setName}
            placeholder="Grandma Ruth"
            autoCapitalize="words"
            maxLength={80}
            accessibilityLabel="Their name"
          />
        </Field>
      ) : null}
      <Field label="What can they do?">
        <View className="gap-2">
          {INVITE_ROLES.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r }}
              className={`flex-row items-start gap-3 rounded-sm border p-3 ${
                role === r ? "border-primary bg-paper" : "border-line bg-surface"
              }`}
            >
              <Ionicons
                name={role === r ? "radio-button-on" : "radio-button-off"}
                size={20}
                colorClassName={role === r ? "accent-primary" : "accent-muted"}
              />
              <View className="flex-1">
                <Text className={`${ROW_TITLE} text-ink`}>{ROLE_LABEL[r]}</Text>
                <Text className="type-caption">{ROLE_DESCRIPTION[r]}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field
        label="Their email (optional)"
        hint="Either way, you'll get a link to share yourself."
      >
        <SheetInput
          value={email}
          onChangeText={setEmail}
          placeholder="ruth@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          accessibilityLabel="Their email"
        />
      </Field>
      <SheetError message={error} />
    </Sheet>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={`rounded-full border px-3 py-2 ${selected ? "border-primary bg-primary" : "border-line bg-surface"}`}
    >
      <Text className={`font-sans-semibold text-[14px] ${selected ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center rounded-md border border-line bg-surface py-4">
      <Text className="font-display text-[22px] text-ink">{value}</Text>
      <Text className="type-caption">{label}</Text>
    </View>
  );
}
