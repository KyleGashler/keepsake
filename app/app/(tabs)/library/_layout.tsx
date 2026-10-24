import { Stack } from "expo-router";
import { useColor } from "../../../src/theme";

/**
 * The Library journey: landing → Child Profiles → a child's collections → one
 * collection. A stack inside the Library tab, so the tab bar stays visible,
 * Library keeps its own history while you visit other tabs, and re-tapping
 * the Library tab pops back here (native-stack does that on `tabPress`).
 *
 * Memory detail is deliberately not in here: it's immersive, on the root
 * stack over the tabs, and backing out of it lands on this stack untouched.
 */
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
