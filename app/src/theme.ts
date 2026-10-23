import { Platform } from "react-native";

/**
 * little by little should feel like a warm room, not a dashboard: paper, a deep-teal
 * ink, one golden-honey accent, and a display serif for the names of things.
 */

/**
 * The palette of the Library journey redesign (design/mockups/, 2026-10-21).
 *
 * Brand guide v1.0 named five colours (sage, dusk blue, golden honey,
 * terracotta, forest) and asked that nothing else invent a hue. The redesign
 * supersedes that: its ink is a deep teal the guide never had, its paper is
 * cooler, and the guide's hues come back retuned as the collection discs'
 * colours. Values were sampled from the mockups. The logo lockups still draw
 * in the ink they were traced with (LOGO_INK in components/brand.tsx).
 */
export const brand = {
  paper: "#FBF8F2",
  deepTeal: "#123F45",
  /** Subtitles and descriptions — a teal-grey that holds 5.2:1 on paper. */
  tealGrey: "#4E6E73",
  goldenHoney: "#D4994A",
  sage: "#8E9A74",
  terracotta: "#D56947",
  forest: "#1D543D",
  duskBlue: "#7DA2B3",
  peach: "#F0DCC8",
} as const;

export const colors = {
  bg: brand.paper,
  surface: "#FFFFFF",
  /** Warm fill for image placeholders, chips and quiet panels. */
  surfaceAlt: "#F3EEE5",
  ink: brand.deepTeal,
  inkSoft: brand.tealGrey,
  /** Captions and meta — 4.6:1 on paper. */
  muted: "#56757A",
  /** Hairlines between rows and around outlined controls. */
  line: "#E6E2D9",
  /** Golden honey: the eyebrow, the sparkle, small moments of delight. */
  accent: "#C8893B",
  /**
   * Honey is too light to carry small text (2.8:1 on paper), so the eyebrow
   * and any honey-coloured words use this deeper shade of it — 4.6:1, AA.
   */
  accentDeep: "#9E6526",
  accentSoft: "#F6EAD6",
  /** Filled controls — the Capture disc, primary buttons, selected toggles. */
  primary: brand.deepTeal,
  onPrimary: "#FFFFFF",
  sage: brand.sage,
  duskBlue: brand.duskBlue,
  terracotta: brand.terracotta,
  /** Delete, and anything else that can't be undone — terracotta deepened until small text holds AA on white. */
  danger: "#B0452C",
  /** The quiet wash behind a warning about what can't be undone. */
  dangerSoft: "#FBEDE7",
  forest: brand.forest,
  overlay: "rgba(18,63,69,0.55)",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 36,
};

/**
 * One page rhythm for every screen, so moving between them never shifts the
 * margins under your thumb.
 */
export const layout = {
  /** Left and right of every page, sheet and header. */
  gutter: spacing.xl,
  /** Below the safe area, above a page's first row. */
  top: spacing.lg,
  /** Between a page's header and the first thing under it. */
  afterHeader: spacing.xl,
  /** Between one labelled section and the next. */
  section: spacing.xxl,
  /** Above the safe area, after the last row of a scroll. */
  bottom: spacing.xxl,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
};

/** Content is capped so the phone layout stays intact on a wide browser. */
export const MAX_WIDTH = 720;

/**
 * Family names as expo-font registers them (app/_layout.tsx loads them). On
 * the web the name is a CSS stack, so text still reads if a font fails to
 * load. Custom fonts ignore `fontWeight` on Android, so each weight is its
 * own family — use `fonts.sansBold`, not `fontWeight: "700"`.
 */
const stack = (family: string, fallback: string) =>
  Platform.OS === "web" ? `${family}, ${fallback}` : family;

const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const fonts = {
  /** DM Serif Display — titles, names of children, collections and memories. */
  display: stack("DMSerifDisplay_400Regular", SERIF_FALLBACK),
  /** Nunito Sans — everything else. */
  sans: stack("NunitoSans_400Regular", SANS_FALLBACK),
  sansSemiBold: stack("NunitoSans_600SemiBold", SANS_FALLBACK),
  sansBold: stack("NunitoSans_700Bold", SANS_FALLBACK),
};

/** Kept for screens that predate `fonts`; it is the display face now. */
export const serif = fonts.display;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.ink },
  heading: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: colors.ink },
  body: { fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 23, color: colors.inkSoft },
  /** A family's own words. The display face is for short names, so stories read in the sans. */
  story: { fontFamily: fonts.sans, fontSize: 17, lineHeight: 27, color: colors.ink },
  label: {
    fontFamily: fonts.sansBold,
    fontSize: 11.5,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
    color: colors.muted,
  },
  /** "LITTLE BY LITTLE" — spaced honey capitals over a page title. */
  eyebrow: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase" as const,
    color: colors.accentDeep,
  },
  caption: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.muted },
};

export const shadow = Platform.select({
  ios: {
    shadowColor: brand.deepTeal,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 3 },
  default: { boxShadow: "0 6px 20px rgba(18,63,69,0.09)" },
});
