import { StyleSheet } from "react-native";
import { colors, fonts, radius, spacing } from "../../theme";

/** The outlined text field the memory page's sheets use. */
export const fieldStyles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md + 2,
    minHeight: 46,
    justifyContent: "center",
  },
  text: { fontFamily: fonts.sans, fontSize: 16, color: colors.ink, paddingVertical: 11 },
  multiline: { minHeight: 140, textAlignVertical: "top", lineHeight: 23 },
});
