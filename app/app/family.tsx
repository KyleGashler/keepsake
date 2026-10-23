import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { apiSend, useApi, type Person } from "../src/api";
import { useSession } from "../src/auth/session-context";
import { VerifyEmailNudge } from "../src/components/account-screens";
import { ActionSheet } from "../src/components/sheet";
import {
  AppHeader,
  Avatar,
  Button,
  ErrorState,
  Loading,
  PreviewNote,
  Screen,
  SectionHeader,
} from "../src/components/ui";
import { SUPPORT_EMAIL } from "../src/support";
import { colors, radius, spacing, type } from "../src/theme";

type Payload = {
  family: { id: string; name: string; createdAt: string };
  members: (Person & { permission: string })[];
  stats: { memoryCount: number; mediaCount: number; collectionCount: number; personCount: number };
  subscription: { plan: string; status: string };
};

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
 */
export default function FamilyHubScreen() {
  const { data, error, loading, refetch } = useApi<Payload>("/api/family");
  const [inviteName, setInviteName] = useState("");
  const [invited, setInvited] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const session = useSession();

  async function invite() {
    if (!inviteName.trim()) return;
    const res = await apiSend<{ invite: { link: string } }>("/api/family/invites", "POST", {
      name: inviteName.trim(),
    });
    setInvited(res.invite.link);
    setInviteName("");
    await refetch();
  }

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading label="Opening Family Hub…" />;
  if (!data) return null;

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

        <SectionHeader label="Members" />
        <View style={{ gap: spacing.lg }}>
          {data.members.map((member) => (
            <Pressable
              key={member.id}
              onPress={() => router.push(`/person/${member.id}`)}
              style={styles.member}
            >
              <Avatar person={member} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15.5, color: colors.ink }}>
                  {member.name}
                  {member.relation ? ` · ${member.relation}` : ""}
                </Text>
                <Text style={type.caption}>{member.permission}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        <SectionHeader label="Invite someone" />
        <View style={styles.inviteRow}>
          <TextInput
            value={inviteName}
            onChangeText={setInviteName}
            placeholder="Grandma Ruth"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Button label="Invite" onPress={invite} />
        </View>
        {invited ? <Text style={[type.caption, { marginTop: spacing.sm }]}>Invite link: {invited}</Text> : null}

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
              <Text style={type.caption}>{session.user?.email}</Text>
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

        <PreviewNote>
          Permissions and billing aren't enforced in this build yet — everyone in a family can see and add
          everything.
        </PreviewNote>

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
      </Screen>
    </>
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
  member: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  inviteRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
  },
  settings: { gap: spacing.lg },
  setting: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
