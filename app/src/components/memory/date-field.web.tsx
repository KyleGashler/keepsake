import { createElement } from "react";
import { View } from "react-native";
import { colors, fonts } from "../../theme";
import type { DateFieldProps } from "./date-field";
import { fieldStyles } from "./field-styles";

export type { DateFieldProps };

/** The browser's own date picker, `<input type="date">`, dressed as a field. */
export function DateField({ value, onChange, accessibilityLabel = "Date" }: DateFieldProps) {
  return (
    <View style={fieldStyles.input}>
      {createElement("input", {
        type: "date",
        value,
        "aria-label": accessibilityLabel,
        onChange: (e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.value),
        style: {
          border: "none",
          outline: "none",
          background: "transparent",
          width: "100%",
          fontFamily: fonts.sans,
          fontSize: 16,
          color: colors.ink,
          padding: 0,
        },
      })}
    </View>
  );
}
