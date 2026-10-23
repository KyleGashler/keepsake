import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
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
import { ActionSheet, Field, Sheet, SheetButton, SheetError, SheetInput, type SheetAction } from "../src/components/sheet";
import { AppHeader, Avatar, ErrorState, Loading, PreviewNote, Screen, SectionHeader } from "../src/components/ui";
import { friendlyError, monthDay } from "../src/format";
import { INVITE_ROLES, ROLE_DESCRIPTION, ROLE_LABEL } from "../src/roles";
import { canCopy, copyLink, shareLink } from "../src/share-link";
import { SUPPORT_EMAIL } from "../src/support";
import { colors, fonts, radius, spacing, type } from "../src/theme";

const SETTINGS = [
  { icon: "lock-closed-outline" as const, label: "Privacy & ownership", detail: "Your family owns every memory" },
  { icon: "card-outline" as const, label: "Subscription", detail: "Not billed in this build" },
  { icon: "download-outline" as const, label: "Export the archive", detail: "Originals, always" },
  { icon: "help-circle-outline" as const, label: "Support", detail: SUPPORT_EMAIL },
];

/**
 * Switching family or signing out: back to Home first, so nothing left on
 * screen belongs to the family (or the person) being left.
 */
function leaveFor(change: () => void) {
  if (router.canDismiss()) router.dismissAll();
  router.replace("/");
  change();
}

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
  const isOwner = data?.role === "OWNER";
  const pending = useApi<{ invites: Invite[] }>(isOwner ? "/api/family/invites" : null);
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const [inviting, setInviting] = useState<{ personId?: string } | null>(null);
  const [managing, setManaging] = useState<FamilyMember | null>(null);
  const [removing, setRemoving] = useState<FamilyMember | null>(null);
  const [inviteActions, setInviteActions] = useState<Invite | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading label="Opening Family Hub…" />;
  if (!data) return null;

  const invitable = data.people.filter((p) => p.invitable);
  const refreshAll = async () => {
    await Promise.all([refetch(), isOwner ? pending.refetch() : Promise.resolve()]);
  };

  /** Do `work`, say what went wrong if it did; true when it worked. */
  const attempt = async (work: () => Promise<unknown>, fallback: string) => {
    setNotice(null);
    try {
      await work();
      return true;
    } catch (err) {
      setNotice(hubError(err, fallback));
      return false;
    }
  };

  const setRole = async (member: FamilyMember, role: MembershipRole) => {
    const ok = await attempt(
      () => apiSend(`/api/family/members/${member.userId}`, "PATCH", { role }),
      "Couldn't change their role just now.",
    );
    // Your own role changed: what the app lets you do changes with it.
    if (ok && member.isYou) await session.refreshAccount();
    await refreshAll();
  };

  const remove = async (member: FamilyMember) => {
    const ok = await attempt(
      () => apiSend(`/api/family/members/${member.userId}`, "DELETE"),
      "Couldn't remove them just now.",
    );
    // You left (another owner remains): this family is no longer yours to look at.
    if (ok && member.isYou) return leaveFor(() => void session.refreshAccount());
    await refreshAll();
  };

  const withdraw = async (invite: Invite) => {
    await attempt(() => apiSend(`/api/family/invites/${invite.id}`, "DELETE"), "Couldn't withdraw it just now.");
    await refreshAll();
  };

  const passOn = async (invite: Invite) => {
    const result = await shareLink(invite.url, inviteMessage(data.family.name));
    if (result === "copied") setNotice("Invite link copied.");
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

        <View style={styles.stats}>
          <Stat value={data.stats.memoryCount} label="Memories" />
          <Stat value={data.stats.mediaCount} label="Media" />
          <Stat value={data.stats.collectionCount} label="Collections" />
          <Stat value={data.stats.personCount} label="People" />
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <SectionHeader label="Members" />
        <View style={{ gap: spacing.lg }}>
          {data.members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              manageable={isOwner}
              onPress={() => {
                if (isOwner) setManaging(member);
                else if (member.person) router.push(`/person/${member.person.id}`);
              }}
            />
          ))}
        </View>

        {data.people.length ? (
          <>
            <SectionHeader label="Also in the archive" />
            <View style={{ gap: spacing.lg }}>
              {data.people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  onPress={() => router.push(`/person/${person.id}`)}
                  onInvite={isOwner && person.invitable ? () => setInviting({ personId: person.id }) : undefined}
                />
              ))}
            </View>
          </>
        ) : null}

        {isOwner ? (
          <>
            <SectionHeader label="Invite someone" />
            <Text style={type.body}>
              Make a link for a grandparent, an aunt, a co-parent — anyone who should see the archive. It works once and
              lasts a week.
            </Text>
            <SheetButton label="Create an invite link" icon="link-outline" onPress={() => setInviting({})} />

            {pending.data?.invites.length ? (
              <>
                <SectionHeader label="Waiting to join" />
                <View style={{ gap: spacing.lg }}>
                  {pending.data.invites.map((invite) => (
                    <Pressable
                      key={invite.id}
                      onPress={() => setInviteActions(invite)}
                      style={({ pressed }) => [styles.member, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                    >
                      <View style={styles.inviteDisc}>
                        <Ionicons name="mail-outline" size={20} color={colors.inkSoft} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{invite.forName ?? "Anyone with the link"}</Text>
                        <Text style={type.caption}>
                          {ROLE_LABEL[invite.role]} · until {monthDay(invite.expiresAt)}
                          {invite.email ? ` · ${invite.email}` : ""}
                        </Text>
                      </View>
                      <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        <SectionHeader label="Settings" />
        <View style={styles.settings}>
          {SETTINGS.map((setting) => (
            <View key={setting.label} style={styles.setting}>
              <Ionicons name={setting.icon} size={18} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: colors.ink }}>{setting.label}</Text>
                <Text style={type.caption}>{setting.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        <SectionHeader label="Account" />
        <View style={styles.settings}>
          <View style={styles.setting}>
            <Ionicons name="person-circle-outline" size={18} color={colors.inkSoft} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: colors.ink }}>Signed in</Text>
              <Text style={type.caption}>
                {session.user?.email} · {ROLE_LABEL[data.role]}
              </Text>
            </View>
          </View>
          {session.memberships.length > 1 ? (
            <Pressable onPress={() => setSwitching(true)} style={styles.setting} accessibilityRole="button">
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: colors.ink }}>Switch family</Text>
                <Text style={type.caption}>You belong to {session.memberships.length} archives</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.muted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => leaveFor(() => void session.signOut())}
            style={styles.setting}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={18} color={colors.terracotta} />
            <Text style={{ fontSize: 15, color: colors.terracotta }}>Sign out</Text>
          </Pressable>
        </View>

        <PreviewNote>Billing isn't set up in this build yet.</PreviewNote>

        <ActionSheet
          visible={switching}
          onClose={() => setSwitching(false)}
          title="Switch family"
          subtitle="Which archive would you like to look at?"
          actions={session.memberships.map((m) => ({
            label: m.familyId === session.family?.familyId ? `${m.familyName} (current)` : m.familyName,
            icon: "people-outline" as const,
            onPress: () => {
              if (m.familyId !== session.family?.familyId) leaveFor(() => session.selectFamily(m.familyId));
            },
          }))}
        />

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
                              if (r === "copied") setNotice("Invite link copied.");
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

        {inviting ? (
          <InviteSheet
            familyName={data.family.name}
            people={invitable}
            initialPersonId={inviting.personId}
            onClose={() => setInviting(null)}
            onCreated={() => void refreshAll()}
          />
        ) : null}
      </Screen>
    </>
  );
}

const ROLE_ICON: Record<MembershipRole, keyof typeof Ionicons.glyphMap> = {
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

function MemberRow({
  member,
  manageable,
  onPress,
}: {
  member: FamilyMember;
  manageable: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.member, pressed && { opacity: 0.7 }]}>
      {member.person ? <Avatar person={member.person} size={44} /> : <Initials name={member.name} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {member.name}
          {member.isYou ? " (you)" : ""}
          {member.person?.relation ? ` · ${member.person.relation}` : ""}
        </Text>
        <Text style={type.caption}>
          {member.permission}
          {member.email ? ` · ${member.email}` : ""}
        </Text>
      </View>
      <Ionicons name={manageable ? "ellipsis-horizontal" : "chevron-forward"} size={17} color={colors.muted} />
    </Pressable>
  );
}

function PersonRow({
  person,
  onPress,
  onInvite,
}: {
  person: FamilyPerson;
  onPress: () => void;
  onInvite?: () => void;
}) {
  return (
    <View style={styles.member}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.member, { flex: 1 }, pressed && { opacity: 0.7 }]}>
        <Avatar person={person} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>
            {person.name}
            {person.relation ? ` · ${person.relation}` : ""}
          </Text>
          <Text style={type.caption}>{person.role === "CHILD" ? "Child" : "No account yet"}</Text>
        </View>
      </Pressable>
      {onInvite ? (
        <Pressable
          onPress={onInvite}
          accessibilityRole="button"
          accessibilityLabel={`Invite ${person.name}`}
          style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.smallButtonLabel}>Invite</Text>
        </Pressable>
      ) : null}
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
    <View style={styles.initials}>
      <Text style={styles.initialsText}>{initials}</Text>
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
        footer={<SheetButton label="Done" variant="secondary" onPress={onClose} />}
      >
        <View style={styles.linkBox}>
          <Text selectable style={styles.linkText}>
            {invite.url}
          </Text>
        </View>
        {emailed && invite.email ? (
          <Text style={type.caption}>We've also emailed it to {invite.email}.</Text>
        ) : null}
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
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Invite someone"
      subtitle={`A link to join ${familyName}.`}
      footer={<SheetButton label="Create the link" onPress={() => void create()} busy={busy} />}
    >
      <Field label="Who is this?">
        <View style={styles.chips}>
          {people.map((p) => (
            <Chip key={p.id} label={p.name} selected={who === p.id} onPress={() => setWho(p.id)} />
          ))}
          <Chip label="Someone new" selected={who === "new"} onPress={() => setWho("new")} />
        </View>
      </Field>
      {who === "new" ? (
        <Field label="Their name" hint="How they'll appear in the archive. Leave it empty to use the name on their account.">
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
        <View style={{ gap: spacing.sm }}>
          {INVITE_ROLES.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r }}
              style={[styles.roleOption, role === r && styles.roleOptionSelected]}
            >
              <Ionicons
                name={role === r ? "radio-button-on" : "radio-button-off"}
                size={20}
                color={role === r ? colors.primary : colors.muted}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{ROLE_LABEL[r]}</Text>
                <Text style={type.caption}>{ROLE_DESCRIPTION[r]}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field
        label="Their email (optional)"
        hint="Emailing invites isn't switched on yet — share the link yourself, by message or however your family talks."
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
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  stat: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  statValue: { fontFamily: type.title.fontFamily, fontSize: 22, color: colors.ink },
  notice: { ...type.caption, color: colors.accentDeep, marginTop: spacing.md },
  member: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowTitle: { fontSize: 15.5, color: colors.ink, fontFamily: fonts.sans },
  initials: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: { fontFamily: fonts.sansBold, color: colors.inkSoft },
  inviteDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButton: {
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  smallButtonLabel: { fontFamily: fonts.sansBold, fontSize: 13.5, color: colors.ink },
  linkBox: {
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  linkText: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.ink },
  roleOption: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  roleOptionSelected: { borderColor: colors.primary },
  settings: { gap: spacing.lg },
  setting: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
