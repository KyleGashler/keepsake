import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSession } from "../auth/session-context";
import { leaveFor } from "../routes";
import { colors, spacing, type } from "../theme";
import { ActionSheet } from "./sheet";

/** Every archive the person belongs to; picking another one switches to it. */
export function FamilySwitchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const session = useSession();
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
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
  );
}

/**
 * The eyebrow on the tab landings: which family's archive this is. For someone
 * in more than one, it's also the way to switch — tap the name.
 */
export function FamilyEyebrow() {
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const name = session.family?.familyName ?? "Little by little";

  if (session.memberships.length < 2) return <Text style={[type.eyebrow, styles.eyebrow]}>{name}</Text>;

  return (
    <>
      <Pressable
        onPress={() => setSwitching(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${name}. Switch family`}
        style={({ pressed }) => [styles.switcher, pressed && { opacity: 0.6 }]}
      >
        <Text style={type.eyebrow}>{name}</Text>
        <Ionicons name="chevron-down" size={13} color={colors.accentDeep} />
      </Pressable>
      <FamilySwitchSheet visible={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginBottom: spacing.xs },
  switcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginBottom: spacing.xs,
  },
});
