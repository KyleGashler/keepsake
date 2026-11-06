import { Stack } from "expo-router";
import { useColor } from "../../../src/theme";

// oxlint-disable-next-line react/only-export-components -- expo-router reads unstable_settings from the layout module
export const unstable_settings = {
  // A deep link or `withAnchor` navigation into the stack puts the landing underneath.
  anchor: "index",
};

export default function LibraryLayout() {
  const paper = useColor("paper");
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: paper },
      }}
    />
  );
}
