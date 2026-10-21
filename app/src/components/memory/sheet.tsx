import { Ionicons } from "@expo/vector-icons";
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
import { colors, fonts, MAX_WIDTH, radius, spacing } from "../../theme";
import { DANGER } from "./helpers";


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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <View style={styles.backdrop} />
        </Pressable>
        <View
          style={[
            styles.panel,
            tall && { height: "88%" },
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          <View style={styles.grabber} />
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
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {onCancel ? (
          <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
            <Text style={styles.cancel}>{cancelLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.headerSide, { alignItems: "flex-end" }]}>
        {action ? (
          <Pressable
            onPress={action.onPress}
            disabled={action.disabled}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.actionPill,
              action.disabled && { opacity: 0.45 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.actionLabel}>{action.label}</Text>
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
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Quiet words on the right — "Coming soon". */
  note?: string;
  divider?: boolean;
}) {
  const tint = danger ? DANGER : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, divider && styles.rowDivider, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.muted : tint} />
      <Text style={[styles.rowLabel, { color: disabled ? colors.muted : tint }]}>{label}</Text>
      {note ? <Text style={styles.rowNote}>{note}</Text> : null}
    </Pressable>
  );
}

/** Small spaced capitals over a form field — "TITLE", "DATE". */
export function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: "rgba(18,63,69,0.42)" },
  panel: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    maxHeight: "92%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 2,
    borderTopRightRadius: radius.lg + 2,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", minHeight: 44, marginBottom: spacing.md },
  headerSide: { width: 84 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: fonts.sansBold,
    fontSize: 16.5,
    color: colors.ink,
  },
  cancel: { fontFamily: fonts.sans, fontSize: 16, color: colors.ink },
  actionPill: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg + 2,
  },
  actionLabel: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.onPrimary },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.lg - 1 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowLabel: { flex: 1, fontFamily: fonts.sans, fontSize: 16.5 },
  rowNote: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 11.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 6,
  },
});
