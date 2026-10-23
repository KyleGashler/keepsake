import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../auth/session-context";
import { leaveFor } from "../routes";
import { colors, fonts, spacing } from "../theme";
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
 * Beside search and settings on the tab landings: which family's archive this
 * is. For someone in more than one, it's also the way to switch — tap it.
 */
export function FamilyPill() {
  const session = useSession();
  const [switching, setSwitching] = useState(false);
  const name = session.family?.familyName;
  if (!name) return null;

  const label = (
    <Text style={styles.name} numberOfLines={1}>
      {name}
    </Text>
  );
  if (session.memberships.length < 2) return <View style={styles.pill}>{label}</View>;

  return (
    <>
      <Pressable
        onPress={() => setSwitching(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${name}. Switch family`}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.6 }]}
      >
        {label}
        <Ionicons name="chevron-down" size={15} color={colors.inkSoft} />
      </Pressable>
      <FamilySwitchSheet visible={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  /** The height and fill of the round search and gear buttons beside it. */
  pill: {
    height: 44,
    maxWidth: 160,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceAlt,
  },
  name: { flexShrink: 1, fontFamily: fonts.sansSemiBold, fontSize: 14.5, color: colors.ink },
});
