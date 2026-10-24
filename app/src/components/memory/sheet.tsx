import type { Ionicons as IoniconsGlyphs } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "../../styled";


/**
 * A panel that rises from the bottom over a dimmed page. One Modal hosts
 * every sheet on the memory page and swaps what's inside, so moving from the
 * options menu to, say, the edit form never has two native modals in flight.
 */
export function Sheet({
  visible,
  onClose,
  children,
  tall = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Forms and pickers: most of the screen, so a list has room to scroll. */
  tall?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <View className="flex-1 bg-ink/42" />
        </Pressable>
        <View
          className={`max-h-[92%] w-full max-w-page self-center rounded-t-[24px] bg-surface px-gutter pt-2 ${tall ? "h-[88%]" : ""}`}
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-3 h-1 w-10 self-center rounded-[2px] bg-line" />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** "Cancel · Edit Memory · Save" — the bar across the top of a form sheet. */
export function SheetHeader({
  title,
  onCancel,
  cancelLabel = "Cancel",
  action,
}: {
  title: string;
  onCancel?: () => void;
  cancelLabel?: string;
  /** The deep-teal pill on the right. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View className="mb-3 min-h-11 flex-row items-center">
      <View className="w-[84px]">
        {onCancel ? (
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
            <Text className="font-sans text-[16px] text-ink">{cancelLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text
        className="flex-1 text-center font-sans-bold text-[16.5px] text-ink"
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View className="w-[84px] items-end">
        {action ? (
          <Pressable
            onPress={action.onPress}
            disabled={action.disabled}
            accessibilityRole="button"
            className={`rounded-full bg-primary px-[18px] py-2 active:opacity-80 ${action.disabled ? "opacity-45" : ""}`}
          >
            <Text className="font-sans-bold text-[15px] text-on-primary">{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** One row of the options menu: an outline glyph, a label, a hairline under it. */
export function SheetRow({
  icon,
  label,
  onPress,
  danger = false,
  disabled = false,
  note,
  divider = true,
}: {
  icon: keyof typeof IoniconsGlyphs.glyphMap;
  label: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Quiet words on the right — "Coming soon". */
  note?: string;
  divider?: boolean;
}) {
  let tint = { icon: "accent-ink", text: "text-ink" };
  if (danger) tint = { icon: "accent-danger", text: "text-danger" };
  if (disabled) tint = { icon: "accent-muted", text: "text-muted" };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`flex-row items-center gap-4 py-[15px] active:opacity-60 ${divider ? "border-line" : ""}`}
      style={divider ? { borderBottomWidth: StyleSheet.hairlineWidth } : undefined}
    >
      <Ionicons name={icon} size={20} colorClassName={tint.icon} />
      <Text className={`flex-1 font-sans text-[16.5px] ${tint.text}`}>{label}</Text>
      {note ? <Text className="font-sans text-[13px] text-muted">{note}</Text> : null}
    </Pressable>
  );
}

/** Small spaced capitals over a form field — "TITLE", "DATE". */
export function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="mb-1.5 font-sans-bold text-[11.5px] tracking-[1.2px] text-muted uppercase">{children}</Text>
  );
}
