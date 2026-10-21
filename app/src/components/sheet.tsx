import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, MAX_WIDTH, radius, spacing, type } from "../theme";

/**
 * A bottom sheet in the journey's language: paper, a grab handle, a display
 * title and a close button, over a teal scrim. A React Native Modal, so it
 * presents above the tab bar on every platform, the web included (where the
 * Escape key closes it). The panel rises in; the scrim fades.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the scrolling body — the sheet's main button. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [rise] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    Animated.timing(rise, {
      toValue: 1,
      duration: 260,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [visible, rise]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.avoider}
        >
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.panel,
              { paddingBottom: insets.bottom + spacing.lg },
              {
                opacity: rise,
                transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
              },
            ]}
          >
            <View style={styles.handle} />
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export type SheetAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

/** A short menu of choices in a Sheet — instead of a browser confirm() or a native alert. */
export function ActionSheet({
  visible,
  onClose,
  title,
  subtitle,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: SheetAction[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <View>
        {actions.map((action, i) => {
          const tint = action.destructive ? colors.terracotta : colors.ink;
          return (
            <Pressable
              key={action.label}
              onPress={() => {
                onClose();
                // A browser only opens a file chooser inside the press itself.
                // Natively, let the sheet finish leaving first: iOS won't
                // present a picker over a modal that is still dismissing.
                if (Platform.OS === "web") action.onPress();
                else setTimeout(action.onPress, 350);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.action,
                i < actions.length - 1 && styles.actionDivider,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.actionIcon}>
                <Ionicons name={action.icon} size={20} color={tint} />
              </View>
              <Text style={[styles.actionLabel, { color: tint }]}>{action.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** A labelled form control. */
export function Field({
  label,
  hint,
  error,
  children,
  style,
}: {
  label: string;
  hint?: string | null;
  error?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/** A text box in the sheet's style. The props are TextInput's own. */
export function SheetInput({
  value,
  onChangeText,
  onBlur,
  onSubmitEditing,
  placeholder,
  multiline,
  autoFocus,
  autoCapitalize,
  autoCorrect,
  keyboardType,
  returnKeyType,
  maxLength,
  accessibilityLabel,
}: Pick<
  TextInputProps,
  | "value"
  | "onChangeText"
  | "onBlur"
  | "onSubmitEditing"
  | "placeholder"
  | "multiline"
  | "autoFocus"
  | "autoCapitalize"
  | "autoCorrect"
  | "keyboardType"
  | "returnKeyType"
  | "maxLength"
  | "accessibilityLabel"
>) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      onSubmitEditing={onSubmitEditing}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      multiline={multiline}
      autoFocus={autoFocus}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      keyboardType={keyboardType}
      returnKeyType={returnKeyType}
      maxLength={maxLength}
      accessibilityLabel={accessibilityLabel}
      style={[styles.input, multiline && styles.inputMultiline]}
    />
  );
}

/** The sheet's buttons: a filled teal pill, or a quiet outlined one. */
export function SheetButton({
  label,
  onPress,
  variant = "primary",
  busy,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  busy?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === "primary";
  const fg = primary ? colors.onPrimary : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || busy) && styles.buttonDisabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : null}
      {!busy && icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A sentence that went wrong, in the sheet's voice. */
export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.terracotta} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
  avoider: { flex: 1, justifyContent: "flex-end", pointerEvents: "box-none" },
  panel: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    maxHeight: "92%",
    alignSelf: "center",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.ink },
  subtitle: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, color: colors.inkSoft, marginTop: 2 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.lg },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.sm },

  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md + 2 },
  actionDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontFamily: fonts.sansSemiBold, fontSize: 16.5 },

  field: { gap: spacing.sm },
  fieldLabel: { ...type.label, color: colors.inkSoft },
  fieldHint: { ...type.caption },
  fieldError: { ...type.caption, color: colors.terracotta },
  input: {
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink,
  },
  inputMultiline: { minHeight: 84, textAlignVertical: "top" },

  button: {
    height: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontFamily: fonts.sansBold, fontSize: 16 },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: "#FBEDE7",
  },
  errorText: { flex: 1, fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 20, color: colors.ink },
});
