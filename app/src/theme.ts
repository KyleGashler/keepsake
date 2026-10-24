import { useCSSVariable } from "uniwind";

/*
 * The theme itself — colours, fonts, radius, spacing, shadow and the type
 * scale — lives in src/global.css as Tailwind tokens. This file is the little
 * that JS still needs from it.
 */

/**
 * One page rhythm for every screen, for layout maths in JS (content widths,
 * inset padding). Must match the `--spacing-*` steps in global.css.
 */
export const layout = {
  /** Left and right of every page, sheet and header. */
  gutter: 24,
  /** Below the safe area, above a page's first row. */
  top: 16,
  /** Between a page's header and the first thing under it. */
  afterHeader: 24,
  /** Between one labelled section and the next. */
  section: 36,
  /** Above the safe area, after the last row of a scroll. */
  bottom: 36,
};

/** Content is capped so the phone layout stays intact on a wide browser. Must match `--container-page`. */
export const MAX_WIDTH = 720;

export type ColorName =
  | "white"
  | "black"
  | "transparent"
  | "deep-teal"
  | "teal-grey"
  | "golden-honey"
  | "sage"
  | "terracotta"
  | "forest"
  | "dusk-blue"
  | "peach"
  | "cream"
  | "scrim"
  | "logo-ink"
  | "paper"
  | "surface"
  | "surface-alt"
  | "ink"
  | "ink-soft"
  | "muted"
  | "line"
  | "accent"
  | "accent-deep"
  | "accent-soft"
  | "primary"
  | "on-primary"
  | "danger"
  | "danger-soft"
  | "error"
  | "pale-disc-glyph";

/**
 * A theme colour as a raw value, for props that take a colour rather than a
 * class — an icon, an SVG fill, a navigator's options. Prefer a class
 * (`text-ink`, or `colorClassName="accent-ink"`) wherever one fits.
 */
export function useColor(name: ColorName): string {
  return String(useCSSVariable(`--color-${name}`));
}
