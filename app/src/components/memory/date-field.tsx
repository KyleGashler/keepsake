import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, TextInput, View } from "react-native";
import { colors } from "../../theme";
import { fieldStyles } from "./field-styles";

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
    <View style={[fieldStyles.input, styles.row]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.muted}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        accessibilityLabel={accessibilityLabel}
        style={[fieldStyles.text, { flex: 1 }]}
      />
      <Ionicons name="calendar-outline" size={18} color={colors.inkSoft} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
});
