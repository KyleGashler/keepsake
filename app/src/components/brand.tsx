import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { colors } from "../theme";
import {
  MARK_K_PATH,
  MARK_RING_PATH,
  MARK_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_TWINKLE_PATH,
  WORDMARK_VIEWBOX,
} from "./brand-artwork";

/**
 * The Keepsake brand kit (brand guide v1.0).
 *
 * Two logo lockups — the wordmark and the K mark — plus the six approved
 * whimsical shapes. The guide is explicit that the shapes are used "sparingly
 * to bring moments of wonder and delight", so each one appears exactly once in
 * the app; the map of where lives in the comment above each usage.
 *
 * Both lockups are the guide's own artwork, traced out of the brand sheet (see
 * brand-artwork.ts). The guide says of the mark: "Do not alter or recreate" —
 * so these draw the paths as-is, and only the fills are themeable.
 */

/**
 * The logotype is drawn in a neutral near-black on the brand sheet, not in
 * Forest — every piece of type on the guide is, Forest being a palette colour
 * rather than a text one. App type uses Forest (colors.ink); the lockups keep
 * the ink they were drawn with.
 */
const LOGO_INK = "#141716";

/** Ratios come from the traced viewBoxes, so each lockup keeps its proportions. */
function ratio(viewBox: string) {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return w / h;
}

type ShapeProps = {
  /** Width in points; height follows each shape's own aspect ratio. */
  size?: number;
  color?: string;
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

/** The signature four-point star. Every other sparkle in the kit reuses it. */
const TWINKLE =
  "M12 1 C12.5 7.5 16.5 11.5 23 12 C16.5 12.5 12.5 16.5 12 23 " +
  "C11.5 16.5 7.5 12.5 1 12 C7.5 11.5 11.5 7.5 12 1 Z";

// ---------------------------------------------------------------------------
// Logos
// ---------------------------------------------------------------------------

const WORDMARK_RATIO = ratio(WORDMARK_VIEWBOX);
const MARK_RATIO = ratio(MARK_VIEWBOX);

/** Primary logo: the wordmark with its twinkle. */
export function KeepsakeWordmark({
  width = 150,
  color = LOGO_INK,
  accent = colors.accent,
  style,
}: {
  /** Rendered width in points; height follows the lockup's ratio. */
  width?: number;
  color?: string;
  accent?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const height = width / WORDMARK_RATIO;
  return (
    <View
      style={[{ width, height }, style]}
      accessibilityRole="header"
      accessibilityLabel="Keepsake"
    >
      <Svg width={width} height={height} viewBox={WORDMARK_VIEWBOX}>
        <Path d={WORDMARK_PATH} fill={color} />
        <Path d={WORDMARK_TWINKLE_PATH} fill={accent} />
      </Svg>
    </View>
  );
}

/**
 * Icon / mark: the K in its circle. The guide reserves this for the app icon
 * and "small spaces where the full logo does not fit".
 */
export function KeepsakeMark({
  size = 40,
  color = LOGO_INK,
  accent = colors.accent,
  style,
}: {
  size?: number;
  color?: string;
  accent?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const height = size / MARK_RATIO;
  return (
    <View
      style={[{ width: size, height }, style]}
      accessibilityRole="image"
      accessibilityLabel="Keepsake"
    >
      <Svg width={size} height={height} viewBox={MARK_VIEWBOX}>
        {/* The ring is drawn broken where the K's swash crosses it. */}
        <Path d={MARK_RING_PATH} fill={accent} />
        <Path d={MARK_K_PATH} fill={color} />
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Whimsical shapes & accents
// ---------------------------------------------------------------------------

/** Twinkle — the four-point star on its own. */
export function Twinkle({ size = 14, color = colors.accent, opacity = 1, style }: ShapeProps) {
  return (
    <View style={[styles.shape, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={TWINKLE} fill={color} opacity={opacity} />
      </Svg>
    </View>
  );
}

/** Stardust cluster — a scatter of dots with one small star among them. */
export function StardustCluster({ size = 44, color = colors.accent, opacity = 1, style }: ShapeProps) {
  const height = size * (28 / 44);
  return (
    <View style={[styles.shape, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 44 28">
        <G fill={color} opacity={opacity}>
          <Path d={TWINKLE} transform="translate(28 2) scale(0.5)" />
          <Circle cx={6} cy={9} r={1.5} />
          <Circle cx={13} cy={4.5} r={1} />
          <Circle cx={17.5} cy={12} r={1.8} />
          <Circle cx={9.5} cy={17.5} r={1.1} />
          <Circle cx={24} cy={19} r={1.4} />
          <Circle cx={33} cy={14.5} r={1} />
          <Circle cx={38.5} cy={22} r={1.6} />
          <Circle cx={2.5} cy={22.5} r={0.9} />
          <Circle cx={30} cy={25.5} r={1.1} />
          <Circle cx={20} cy={25} r={0.8} />
        </G>
      </Svg>
    </View>
  );
}

/** Shooting star — a twinkle with its trail. */
export function ShootingStar({ size = 44, color = colors.accent, opacity = 1, style }: ShapeProps) {
  const height = size * (30 / 44);
  return (
    <View style={[styles.shape, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 44 30">
        <G opacity={opacity}>
          <Path d={TWINKLE} transform="translate(28 1) scale(0.62)" fill={color} />
          <G stroke={color} strokeWidth={1.4} strokeLinecap="round" fill="none">
            <Path d="M26.5 12.5 C21 15.8 13.5 20.5 4 27" />
            <Path d="M31.5 17.5 C27 20 21.5 23.5 15.5 27.5" />
            <Path d="M21 8 C17.5 10 13 12.8 8 16" />
          </G>
          <Circle cx={5.5} cy={20} r={1.1} fill={color} />
          <Circle cx={12} cy={24.5} r={0.9} fill={color} />
        </G>
      </Svg>
    </View>
  );
}

/** Story arc — the dome a story travels over. */
export function StoryArc({ size = 60, color = colors.accent, opacity = 1, style }: ShapeProps) {
  const height = size * (24 / 60);
  return (
    <View style={[styles.shape, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 60 24">
        <Path
          d="M2 22 A 30 30 0 0 1 58 22"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          fill="none"
          opacity={opacity}
        />
      </Svg>
    </View>
  );
}

/** Dream cloud — flat-bottomed, soft on top. */
export function DreamCloud({ size = 48, color = colors.accent, opacity = 1, style }: ShapeProps) {
  const height = size * (30 / 48);
  return (
    <View style={[styles.shape, { width: size, height }, style]}>
      <Svg width={size} height={height} viewBox="0 0 48 30">
        <Path
          d={
            "M10 24 C5.6 24 2 20.4 2 16 C2 11.9 5.1 8.5 9.1 8.1 " +
            "C10.5 4 14.4 1.2 18.8 1.2 C23.4 1.2 27.5 4.3 28.7 8.7 " +
            "C29.8 7.9 31.2 7.5 32.6 7.5 C36.7 7.5 40 10.8 40 14.9 " +
            "C43.5 15.5 46 18.5 46 22 C46 23.1 45.8 23.6 45.4 24 Z"
          }
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
          opacity={opacity}
        />
      </Svg>
    </View>
  );
}

/** Little moon — a thin crescent. */
export function LittleMoon({ size = 24, color = colors.accent, opacity = 1, style }: ShapeProps) {
  return (
    <View style={[styles.shape, { width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d={
            "M14 2.2 a 10 10 0 1 0 0 19.6 " +
            "C 9.4 18.6 8.6 15.4 8.6 12 C 8.6 8.6 9.4 5.4 14 2.2 Z"
          }
          fill={color}
          opacity={opacity}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shape: { pointerEvents: "none" },
});
