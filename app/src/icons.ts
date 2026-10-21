import type { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { brand } from "./theme";

export type IconSpec =
  | { set: "ion"; name: keyof typeof Ionicons.glyphMap }
  | { set: "mci"; name: keyof typeof MaterialCommunityIcons.glyphMap };

/**
 * Every glyph a collection disc can carry (`<IconDisc icon=… />`). The server
 * stores the key in `Collection.icon`, so keys are permanent: add, never
 * rename. Custom collections pick from this same set.
 */
export const ICONS = {
  sparkles: { set: "ion", name: "sparkles-outline" },
  rainbow: { set: "mci", name: "looks" },
  chat: { set: "ion", name: "chatbubble-ellipses-outline" },
  cake: { set: "mci", name: "cake-variant-outline" },
  heart: { set: "ion", name: "heart-outline" },
  butterfly: { set: "mci", name: "butterfly-outline" },
  moon: { set: "ion", name: "moon-outline" },
  star: { set: "ion", name: "star-outline" },
  book: { set: "ion", name: "book-outline" },
  music: { set: "ion", name: "musical-notes-outline" },
  leaf: { set: "ion", name: "leaf-outline" },
  sun: { set: "ion", name: "sunny-outline" },
  camera: { set: "ion", name: "camera-outline" },
  home: { set: "ion", name: "home-outline" },
  paw: { set: "ion", name: "paw-outline" },
  plane: { set: "ion", name: "airplane-outline" },
} as const satisfies Record<string, IconSpec>;

export type IconKey = keyof typeof ICONS;

export function isIconKey(key: string): key is IconKey {
  return Object.hasOwn(ICONS, key);
}

/** In registry order — what an icon picker lists. */
export const ICON_KEYS: IconKey[] = Object.keys(ICONS).filter(isIconKey);

/** A stored key the app doesn't know (a newer server, a typo) shows sparkles. */
export function iconSpec(key: string): IconSpec {
  return ICONS[isIconKey(key) ? key : "sparkles"];
}

/**
 * Disc colours a family can pick for a custom collection: the seven the
 * default child collections use, in their order (Milestones … Phases).
 */
export const DISC_COLORS = [
  brand.goldenHoney,
  brand.sage,
  brand.deepTeal,
  brand.terracotta,
  brand.forest,
  brand.duskBlue,
  brand.peach,
] as const;

/** The gold a glyph takes on a pale disc (the moon on peach). */
const PALE_DISC_GLYPH = "#B5853F";

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White on a coloured disc; gold on a pale one, where white would vanish. */
export function glyphColorFor(discColor: string) {
  return luminance(discColor) > 0.55 ? PALE_DISC_GLYPH : "#FFFFFF";
}
