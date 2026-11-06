import { Pressable, Text } from "react-native";
import { Ionicons } from "../styled";

export function DateButton({ label, onPress, className }: { label: string; onPress: () => void; className: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Date, ${label}. Change`}
      className={`flex-row items-center justify-between gap-2 active:opacity-70 ${className}`}
    >
      <Text className="text-[15.5px] leading-[24px] text-ink" numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="calendar-outline" size={17} colorClassName="accent-muted" />
    </Pressable>
  );
}
