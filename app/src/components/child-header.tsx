import type { Href } from "expo-router";
import { useId } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, Line, RadialGradient, Rect, Stop } from "react-native-svg";
import { mediaUrl, type ChildSummary, type Person } from "../api";
import { childMeta } from "../format";
import { backTo } from "../routes";
import { Image, Ionicons } from "../styled";
import { useColor } from "../theme";
import { Sparkle } from "./journey";

/**
 * A child's face in the Library journey: their uploaded photo, or — before
 * anyone has added one — a monogram in their own accent colour. Never the
 * generated avatar gradient on its own, which reads as a broken image at
 * this size.
 */
export function ChildPortrait({
  child,
  size,
  uri,
  style,
  className = "",
}: {
  child: Pick<Person, "name" | "accentColor" | "initials">;
  size: number;
  /** A photo URL (relative API paths resolve); null shows the monogram. */
  uri: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  const resolved = mediaUrl(uri);
  return (
    <View
      className={`items-center justify-center overflow-hidden ${className}`}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: child.accentColor }, style]}
    >
      {resolved ? (
        <Image source={{ uri: resolved }} className="absolute inset-0" contentFit="cover" transition={200} />
      ) : (
        <Text className="font-display text-white text-center" style={{ fontSize: size * 0.46, lineHeight: size * 0.6 }}>
          {child.name.trim().charAt(0).toUpperCase() || child.initials}
        </Text>
      )}
    </View>
  );
}

/**
 * What a child's photo card shows until they have a photo: a warm wash of
 * their accent colour with their monogram where a face would be, so the card
 * looks intentional rather than empty.
 */
export function ChildCardBackdrop({ child }: { child: Pick<Person, "name" | "accentColor" | "initials"> }) {
  const id = `wash-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const surfaceAlt = useColor("surface-alt");
  return (
    <View className="absolute inset-0 pointer-events-none">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="68%" cy="45%" rx="60%" ry="95%">
            <Stop offset="0" stopColor={child.accentColor} stopOpacity={0.55} />
            <Stop offset="1" stopColor={child.accentColor} stopOpacity={0.08} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={surfaceAlt} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <View className="absolute top-0 bottom-0 right-[16%] justify-center">
        <ChildPortrait child={child} size={104} uri={null} className="border-4 border-white/75" />
      </View>
    </View>
  );
}

/** "‹ Child Profiles" on the left, an optional gear on the right. */
export function BackRow({
  label,
  parent,
  onSettings,
  settingsLabel = "Settings",
}: {
  label: string;
  /** The screen back returns to, even on a cold deep link (routes.ts `backTo`). */
  parent: Href;
  onSettings?: () => void;
  settingsLabel?: string;
}) {
  return (
    <View className="flex-row items-center justify-between min-h-11 mb-3">
      <Pressable
        onPress={() => backTo(parent)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        className="flex-row items-center gap-1 -ml-1 active:opacity-70"
      >
        <Ionicons name="chevron-back" size={22} colorClassName="accent-ink" />
        <Text className="font-sans text-[17px] text-ink">{label}</Text>
      </Pressable>
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={settingsLabel}
          className="w-11 h-11 items-center justify-center -mr-2 active:opacity-70"
        >
          <Ionicons name="settings-outline" size={27} colorClassName="accent-ink" />
        </Pressable>
      ) : null}
    </View>
  );
}

const PORTRAIT = 88;
/** The flourish canvas overhangs the portrait so the dashes and star can sit outside it. */
const FLOURISH_PAD = 22;

/**
 * The top of a child's screens (design/mockups/03): the round photo with a
 * small teal sparkle above it and three teal dashes beside it, then the
 * child's name and their age and counts. Below a back row the screen draws.
 */
export function ChildHeader({ child }: { child: ChildSummary }) {
  const c = PORTRAIT / 2 + FLOURISH_PAD;
  // Three short radial strokes off the photo's lower left, like a little burst of joy.
  const dashes = [174, 160, 146].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const from = PORTRAIT / 2 + 7;
    const to = from + 9;
    return {
      deg,
      x1: c + Math.cos(rad) * from,
      y1: c + Math.sin(rad) * from,
      x2: c + Math.cos(rad) * to,
      y2: c + Math.sin(rad) * to,
    };
  });
  const meta = childMeta(child);
  const ink = useColor("ink");

  return (
    <View className="flex-row items-center gap-5">
      <View style={{ width: PORTRAIT, height: PORTRAIT }}>
        <Svg
          width={PORTRAIT + FLOURISH_PAD * 2}
          height={PORTRAIT + FLOURISH_PAD * 2}
          style={{ position: "absolute", left: -FLOURISH_PAD, top: -FLOURISH_PAD, pointerEvents: "none" }}
        >
          {dashes.map((d) => (
            <Line
              key={d.deg}
              x1={d.x1}
              y1={d.y1}
              x2={d.x2}
              y2={d.y2}
              stroke={ink}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </Svg>
        <ChildPortrait child={child} size={PORTRAIT} uri={child.photoUrl} />
        <Sparkle size={24} color={ink} variant="outline" strokeWidth={1.8} className="absolute -right-4 -top-[18px]" />
      </View>
      <View className="flex-1 pt-2">
        <Text className="type-display" numberOfLines={2} accessibilityRole="header">
          {child.name}
        </Text>
        {/* Each part stays whole; a long line wraps between parts, never inside one,
            and the dot stays with the part before it so a new line never starts with one. */}
        <View className="flex-row flex-wrap mt-0.5" accessible accessibilityLabel={meta.join(", ")}>
          {meta.map((part, i) => (
            <Text key={part} className="font-sans text-[14px] leading-[20px] text-ink-soft">
              {part}
              {i < meta.length - 1 ? <Text className="text-[11px]">{"  •  "}</Text> : null}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}
