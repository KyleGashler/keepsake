import { TextInput, View } from "react-native";
import { Ionicons } from "../../styled";
import { fieldBox, fieldText } from "./field-styles";

export type DateFieldProps = {
  /** "YYYY-MM-DD", local calendar day. */
  value: string;
  onChange: (day: string) => void;
  accessibilityLabel?: string;
};

/**
 * A calendar day. On a phone it's typed as YYYY-MM-DD — the app has no
 * native date picker dependency yet; the web build uses the browser's own
 * (date-field.web.tsx). The caller validates with `withDay` (src/format.ts).
 */
export function DateField({ value, onChange, accessibilityLabel = "Date" }: DateFieldProps) {
  return (
    <View className={`${fieldBox} flex-row items-center`}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColorClassName="accent-muted"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        accessibilityLabel={accessibilityLabel}
        className={`${fieldText} flex-1`}
      />
      <Ionicons name="calendar-outline" size={18} colorClassName="accent-ink-soft" />
    </View>
  );
}
