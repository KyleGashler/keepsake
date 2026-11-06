import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform } from "react-native";
import { dayLabel, fromLocalDay, localDay } from "../format";
import { DateButton } from "./date-button";
import { Sheet } from "./sheet";

export type DateFieldProps = {
  value: string;
  onChange: (day: string) => void;
  className?: string;
};

export function DateField({ value, onChange, className = "" }: DateFieldProps) {
  const [choosing, setChoosing] = useState(false);
  const [today] = useState(() => new Date());
  const date = fromLocalDay(value);

  function open() {
    if (Platform.OS !== "android") return setChoosing(true);
    DateTimePickerAndroid.open({
      value: date,
      mode: "date",
      maximumDate: today,
      onValueChange: (_, picked) => onChange(localDay(picked)),
    });
  }

  return (
    <>
      <DateButton label={dayLabel(value)} onPress={open} className={className} />
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="When did it happen?">
        <DateTimePicker
          value={date}
          mode="date"
          display="inline"
          maximumDate={today}
          onValueChange={(_, picked) => {
            onChange(localDay(picked));
            setChoosing(false);
          }}
        />
      </Sheet>
    </>
  );
}
