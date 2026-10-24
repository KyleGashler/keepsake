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
import { Ionicons, type IoniconName } from "../styled";

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
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-ink/55"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 justify-end"
          style={{ pointerEvents: "box-none" }}
        >
          <Animated.View
            accessibilityViewIsModal
            className="max-h-[92%] w-full max-w-page self-center rounded-t-[28px] bg-paper pt-2"
            style={{
              paddingBottom: insets.bottom + 16,
              opacity: rise,
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
            }}
          >
            <View className="mb-3 h-[5px] w-10 self-center rounded-[3px] bg-line" />
            <View className="flex-row items-start gap-3 px-gutter pb-4">
              <View className="flex-1">
                <Text className="font-display text-[30px] leading-[36px] text-ink" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text className="mt-0.5 font-sans text-[15px] leading-[21px] text-ink-soft">{subtitle}</Text>
                ) : null}
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="mt-0.5 h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
              >
                <Ionicons name="close" size={20} colorClassName="accent-ink" />
              </Pressable>
            </View>
            {/*
             * Fields sit further from each other (gap-6) than a field's own
             * label, input and hint do (gap-2), so each reads as one group.
             */}
            <ScrollView
              className="grow-0"
              contentContainerClassName="gap-6 px-gutter pb-3"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
            {footer ? <View className="gap-2 px-gutter pt-2">{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export type SheetAction = {
  label: string;
  icon: IoniconName;
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
              className={`flex-row items-center gap-3 py-3.5 active:opacity-70 ${i < actions.length - 1 ? "border-line" : ""}`}
              style={i < actions.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth } : undefined}
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-alt">
                <Ionicons
                  name={action.icon}
                  size={20}
                  colorClassName={action.destructive ? "accent-terracotta" : "accent-ink"}
                />
              </View>
              <Text
                className={`font-sans-semibold text-[16.5px] ${action.destructive ? "text-terracotta" : "text-ink"}`}
              >
                {action.label}
              </Text>
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
    <View className="gap-2" style={style}>
      <Text className="type-label text-ink-soft">{label}</Text>
      {children}
      {error ? <Text className="type-caption text-terracotta">{error}</Text> : null}
      {!error && hint ? <Text className="type-caption">{hint}</Text> : null}
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
  secureTextEntry,
  autoComplete,
  textContentType,
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
  | "secureTextEntry"
  | "autoComplete"
  | "textContentType"
>) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      onSubmitEditing={onSubmitEditing}
      placeholder={placeholder}
      placeholderTextColorClassName="accent-muted"
      multiline={multiline}
      autoFocus={autoFocus}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      keyboardType={keyboardType}
      returnKeyType={returnKeyType}
      maxLength={maxLength}
      accessibilityLabel={accessibilityLabel}
      secureTextEntry={secureTextEntry}
      autoComplete={autoComplete}
      textContentType={textContentType}
      className={`rounded-md border border-line bg-surface px-4 py-3 font-sans text-[16px] text-ink ${multiline ? "min-h-[84px]" : "min-h-[50px]"}`}
      style={multiline ? { textAlignVertical: "top" } : undefined}
    />
  );
}

/**
 * The sheet's buttons: a filled teal pill, a quiet outlined one, or a filled
 * red one (`danger`) for what can't be undone.
 */
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
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
  icon?: IoniconName;
  style?: StyleProp<ViewStyle>;
}) {
  const filled = variant !== "secondary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      className={`h-[52px] flex-row items-center justify-center gap-2 rounded-full px-6 active:opacity-70 ${BUTTON_VARIANT[variant]} ${disabled || busy ? "opacity-50" : ""}`}
      style={style}
    >
      {busy ? (
        <ActivityIndicator colorClassName={filled ? "accent-on-primary" : "accent-ink"} size="small" />
      ) : null}
      {!busy && icon ? (
        <Ionicons name={icon} size={18} colorClassName={filled ? "accent-on-primary" : "accent-ink"} />
      ) : null}
      <Text className={`font-sans-bold text-[16px] ${filled ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

/** A sentence that went wrong, in the sheet's voice. */
export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View className="flex-row items-start gap-2 rounded-sm bg-danger-soft p-3">
      <Ionicons name="alert-circle-outline" size={18} colorClassName="accent-terracotta" />
      <Text className="flex-1 font-sans text-[14.5px] leading-[20px] text-ink">{message}</Text>
    </View>
  );
}

const BUTTON_VARIANT = {
  primary: "bg-primary",
  secondary: "border border-line bg-surface",
  danger: "bg-danger",
} as const;
