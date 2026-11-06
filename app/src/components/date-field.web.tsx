import { createElement, useRef, useState } from "react";
import { View } from "react-native";
import { dayLabel, localDay } from "../format";
import { DateButton } from "./date-button";
import type { DateFieldProps } from "./date-field";

export function DateField({ value, onChange, className = "" }: DateFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [today] = useState(() => localDay(new Date()));
  return (
    <View>
      <DateButton label={dayLabel(value)} onPress={() => input.current?.showPicker()} className={className} />
      {createElement("input", {
        ref: input,
        type: "date",
        value,
        max: today,
        tabIndex: -1,
        "aria-hidden": true,
        onChange: (e: { target: HTMLInputElement }) => {
          if (e.target.value) onChange(e.target.value);
        },
        style: { position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" },
      })}
    </View>
  );
}
