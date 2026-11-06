import type { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

export type IconSpec =
  | { set: "ion"; name: keyof typeof Ionicons.glyphMap }
  | { set: "mci"; name: keyof typeof MaterialCommunityIcons.glyphMap };

// Keys are stored in Collection.icon, so they're permanent: add, never rename.
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

export const ICON_KEYS: IconKey[] = Object.keys(ICONS).filter(isIconKey);

export function iconSpec(key: string): IconSpec {
  return ICONS[isIconKey(key) ? key : "sparkles"];
}

// Literal hex, not theme classes: a disc's colour is data saved in
// Collection.color, and must not move if the brand palette does.
export const DISC_COLORS = [
  "#D4994A",
  "#8E9A74",
  "#123F45",
  "#D56947",
  "#1D543D",
  "#7DA2B3",
  "#F0DCC8",
] as const;

export const COLLECTION_SWATCHES = [...DISC_COLORS, "#4E6E73"] as const;

// Mirrors --color-pale-disc-glyph in src/global.css.
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

export function glyphColorFor(discColor: string) {
  return luminance(discColor) > 0.55 ? PALE_DISC_GLYPH : "#FFFFFF";
}
