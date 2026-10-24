import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSession } from "../auth/session-context";
import { leaveFor } from "../routes";
import { Ionicons } from "../styled";
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
    <Text className="shrink font-sans-semibold text-[14.5px] text-ink" numberOfLines={1}>
      {name}
    </Text>
  );
  if (session.memberships.length < 2) return <View className={PILL}>{label}</View>;

  return (
    <>
      <Pressable
        onPress={() => setSwitching(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${name}. Switch family`}
        className={`${PILL} active:opacity-60`}
      >
        {label}
        <Ionicons name="chevron-down" size={15} colorClassName="accent-ink-soft" />
      </Pressable>
      <FamilySwitchSheet visible={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

/** The height and fill of the round search and gear buttons beside it. */
const PILL = "h-11 max-w-[160px] rounded-full px-3 flex-row items-center gap-1 bg-surface-alt";
