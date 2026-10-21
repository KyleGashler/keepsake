import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { Href } from "expo-router";
import { useId } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, Line, RadialGradient, Rect, Stop } from "react-native-svg";
import { mediaUrl, type ChildSummary, type Person } from "../api";
import { childMeta } from "../format";
import { backTo } from "../routes";
import { colors, fonts, spacing } from "../theme";
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
}: {
  child: Pick<Person, "name" | "accentColor" | "initials">;
  size: number;
  /** A photo URL (relative API paths resolve); null shows the monogram. */
  uri: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const resolved = mediaUrl(uri);
  return (
    <View
      style={[
        styles.portrait,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: child.accentColor },
        style,
      ]}
    >
      {resolved ? (
        <Image source={{ uri: resolved }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <Text style={[styles.monogram, { fontSize: size * 0.46, lineHeight: size * 0.6 }]}>
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
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="68%" cy="45%" rx="60%" ry="95%">
            <Stop offset="0" stopColor={child.accentColor} stopOpacity={0.55} />
            <Stop offset="1" stopColor={child.accentColor} stopOpacity={0.08} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={colors.surfaceAlt} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <View style={styles.backdropPortrait}>
        <ChildPortrait child={child} size={104} uri={null} style={styles.backdropRing} />
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
    <View style={styles.backRow}>
      <Pressable
        onPress={() => backTo(parent)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Back to ${label}`}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
        <Text style={styles.backLabel}>{label}</Text>
      </Pressable>
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={settingsLabel}
          style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
        >
          <Ionicons name="settings-outline" size={27} color={colors.ink} />
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

  return (
    <View style={styles.childHeader}>
      <View style={styles.portraitWrap}>
        <Svg
          width={PORTRAIT + FLOURISH_PAD * 2}
          height={PORTRAIT + FLOURISH_PAD * 2}
          style={styles.flourish}
        >
          {dashes.map((d) => (
            <Line
              key={d.deg}
              x1={d.x1}
              y1={d.y1}
              x2={d.x2}
              y2={d.y2}
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </Svg>
        <ChildPortrait child={child} size={PORTRAIT} uri={child.photoUrl} />
        <Sparkle size={24} color={colors.ink} variant="outline" strokeWidth={1.8} style={styles.portraitSparkle} />
      </View>
      <View style={styles.childText}>
        <Text style={styles.childName} numberOfLines={2} accessibilityRole="header">
          {child.name}
        </Text>
        {/* Each part stays whole; a long line wraps between parts, never inside one,
            and the dot stays with the part before it so a new line never starts with one. */}
        <View style={styles.metaRow} accessible accessibilityLabel={meta.join(", ")}>
          {meta.map((part, i) => (
            <Text key={part} style={styles.childMeta}>
              {part}
              {i < meta.length - 1 ? <Text style={styles.metaDot}>{"  •  "}</Text> : null}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  portrait: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  monogram: { fontFamily: fonts.display, color: "#FFFFFF", textAlign: "center" },
  backdropPortrait: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: "16%",
    justifyContent: "center",
  },
  backdropRing: { borderWidth: 4, borderColor: "rgba(255,255,255,0.75)" },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -4 },
  backLabel: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink },
  gear: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -8 },

  childHeader: { flexDirection: "row", alignItems: "center", gap: spacing.lg + 4, marginTop: spacing.sm },
  portraitWrap: { width: PORTRAIT, height: PORTRAIT },
  flourish: { position: "absolute", left: -FLOURISH_PAD, top: -FLOURISH_PAD, pointerEvents: "none" },
  passThrough: { pointerEvents: "none" },
  portraitSparkle: { position: "absolute", right: -16, top: -18 },
  childText: { flex: 1, paddingTop: spacing.sm },
  childName: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, color: colors.ink },
  metaRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  childMeta: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  metaDot: { fontSize: 11 },
});
