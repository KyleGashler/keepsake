import { useCSSVariable } from "uniwind";

// Must match the `--spacing-*` steps in global.css.
export const layout = {
  gutter: 24,
  top: 16,
  afterHeader: 24,
  section: 36,
  bottom: 36,
};

// Must match `--container-page` in global.css.
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

export function useColor(name: ColorName): string {
  return String(useCSSVariable(`--color-${name}`));
}
