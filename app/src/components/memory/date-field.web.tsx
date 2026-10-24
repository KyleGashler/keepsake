import { createElement } from "react";
import { View } from "react-native";
import type { DateFieldProps } from "./date-field";
import { fieldBox } from "./field-styles";

export type { DateFieldProps };

/** The browser's own date picker, `<input type="date">`, dressed as a field. */
export function DateField({ value, onChange, accessibilityLabel = "Date" }: DateFieldProps) {
  return (
    <View className={fieldBox}>
      {createElement("input", {
        type: "date",
        value,
        "aria-label": accessibilityLabel,
        onChange: (e: { currentTarget: HTMLInputElement }) => onChange(e.currentTarget.value),
        className: "w-full border-none bg-transparent p-0 font-sans text-[16px] text-ink outline-none",
      })}
    </View>
  );
}
