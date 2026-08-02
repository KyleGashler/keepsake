import { Platform } from "react-native";

/**
 * Keepsake should feel like a warm room, not a dashboard: paper tones, ink,
 * one terracotta accent, and a serif reserved for the family's own words.
 */
export const colors = {
  bg: "#FBF7F2",
  surface: "#FFFFFF",
  surfaceAlt: "#F4EDE4",
  ink: "#2A2521",
  inkSoft: "#5C5249",
  muted: "#8A7C70",
  line: "#E8DFD4",
  accent: "#C97B5A",
  accentSoft: "#F3E1D5",
  sage: "#6F8267",
  overlay: "rgba(28,23,19,0.55)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 36,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
};

/** Georgia ships on iOS and the web; Android falls back to its own serif. */
export const serif = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
}) as string;

export const type = {
  display: { fontFamily: serif, fontSize: 30, lineHeight: 37, color: colors.ink },
  title: { fontFamily: serif, fontSize: 23, lineHeight: 30, color: colors.ink },
  heading: { fontFamily: serif, fontSize: 19, lineHeight: 26, color: colors.ink },
  body: { fontSize: 15.5, lineHeight: 24, color: colors.inkSoft },
  story: { fontFamily: serif, fontSize: 17, lineHeight: 29, color: colors.ink },
  label: {
    fontSize: 11.5,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
    color: colors.muted,
    fontWeight: "600" as const,
  },
  caption: { fontSize: 13, lineHeight: 19, color: colors.muted },
};

export const shadow = Platform.select({
  ios: {
    shadowColor: "#8A6A4F",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 3 },
  default: { boxShadow: "0 8px 24px rgba(138,106,79,0.14)" },
}) as object;
