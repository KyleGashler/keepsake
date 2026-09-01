import { Platform } from "react-native";

/**
 * Keepsake should feel like a warm room, not a dashboard: paper tones, ink,
 * one terracotta accent, and a serif reserved for the family's own words.
 */

/**
 * The five approved brand colours, verbatim from the brand guide (v1.0).
 * Nothing else in the app should invent a hue — everything below is either one
 * of these or a tint/shade derived from them.
 */
export const brand = {
  sage: "#A3AA9A",
  duskBlue: "#8FA1A6",
  goldenHoney: "#D49A4A",
  terracotta: "#D68A75",
  forest: "#2F362E",
} as const;

export const colors = {
  /** The guide's paper, sampled from the brand sheet. */
  bg: "#FAF5F1",
  surface: "#FFFFFF",
  surfaceAlt: "#F0EAE0",
  /**
   * App type is Forest — warmer and softer than black, and on-palette. The
   * logo is deliberately not this; it keeps the near-black it's drawn in
   * (see LOGO_INK in components/brand.tsx), because the guide says not to
   * alter the lockups.
   */
  ink: brand.forest,
  inkSoft: "#555B50",
  muted: "#6F6E64",
  line: "#E4DDD1",
  accent: brand.goldenHoney,
  /**
   * Golden Honey is too light to carry white text (2.2:1), so filled controls
   * use this deeper shade of the same hue — 4.8:1, which clears AA.
   */
  accentDeep: "#9E6526",
  accentSoft: "#F7EBD8",
  sage: brand.sage,
  duskBlue: brand.duskBlue,
  terracotta: brand.terracotta,
  forest: brand.forest,
  overlay: "rgba(47,54,46,0.55)",
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
    shadowColor: brand.forest,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 3 },
  default: { boxShadow: "0 8px 24px rgba(47,54,46,0.10)" },
}) as object;
