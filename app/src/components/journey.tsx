import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { useId, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { mediaUrl } from "../api";
import { glyphColorFor, iconSpec } from "../icons";
import { colors, fonts, MAX_WIDTH, radius, shadow, spacing, type } from "../theme";
import { Twinkle } from "./brand";

/**
 * The visual language of the Library journey redesign (design/mockups/):
 * big display titles over paper, photo cards with a soft light scrim, round
 * coloured discs for collections, hairline lists. Every screen in the journey
 * is assembled from these. The disc icon registry lives in src/icons.ts.
 */

// ---------------------------------------------------------------------------
// Sparkle
// ---------------------------------------------------------------------------

/**
 * The four-point star (the brand kit's twinkle) — beside a page title, and the
 * Mosaic tab's icon. Outlined by default, as the mockups draw it.
 */
export function Sparkle({
  size = 22,
  color = colors.accent,
  variant = "outline",
  strokeWidth = 1.6,
  style,
}: {
  size?: number;
  color?: ColorValue;
  variant?: "outline" | "filled";
  /** Outline weight in viewBox units (24), so it scales with `size`. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Twinkle
      size={size}
      color={color}
      strokeWidth={variant === "outline" ? strokeWidth : undefined}
      style={style}
    />
  );
}

// ---------------------------------------------------------------------------
// IconDisc
// ---------------------------------------------------------------------------

/** A registry glyph (src/icons.ts) on its own. Unknown keys show sparkles. */
export function Glyph({ icon, size, color }: { icon: string; size: number; color: string }) {
  const spec = iconSpec(icon);
  return spec.set === "ion" ? (
    <Ionicons name={spec.name} size={size} color={color} />
  ) : (
    <MaterialCommunityIcons name={spec.name} size={size} color={color} />
  );
}

/** A coloured circle with a glyph — a collection's face. Unknown icon keys fall back to sparkles. */
export function IconDisc({
  icon,
  color,
  size = 56,
  style,
}: {
  icon: string;
  /** Disc colour, hex. */
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    >
      <Glyph icon={icon} size={Math.round(size * 0.46)} color={glyphColorFor(color)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------

/**
 * The top of every journey screen: an optional "‹ Library" back label, the
 * honey eyebrow, a big display title (with the sparkle, if asked), a
 * teal-grey subtitle, and an optional gear on the right. It sits inside the
 * screen's scroll content, so it scrolls away with the page.
 */
/** Below this window width, a header's accessory moves up to the eyebrow's line. */
const NARROW = 520;

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  backLabel,
  onBack,
  backFallback = "/library",
  sparkle = false,
  sparkleAtEnd = false,
  onSettings,
  onSearch,
  accessory,
  children,
}: {
  title: string;
  /** e.g. "Little by little" — rendered in spaced capitals. */
  eyebrow?: string;
  subtitle?: string;
  /** Shows "‹ {backLabel}" above the title. Goes back, or to `backFallback` on a cold deep link. */
  backLabel?: string;
  onBack?: () => void;
  backFallback?: Href;
  /** The gold four-point star after the title. */
  sparkle?: boolean;
  /** Puts the sparkle at the far right of the title line, as Child Profiles draws it. */
  sparkleAtEnd?: boolean;
  /** Shows the gear button top-right. */
  onSettings?: () => void;
  /** Shows a search button beside the gear. */
  onSearch?: () => void;
  /** Sits before the search and gear buttons, e.g. `FamilyPill`. */
  accessory?: ReactNode;
  /** Anything that belongs between the subtitle and the page body. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // On a phone the title, the accessory and the buttons don't fit on one
  // line, so the accessory moves up to the eyebrow's, above the buttons.
  const eyebrowRow = !backLabel && !!eyebrow && !!accessory && width < NARROW;
  const besideButtons = eyebrowRow ? null : accessory;
  const goBack =
    onBack ?? (() => (router.canGoBack() ? router.back() : router.replace(backFallback)));
  const actions =
    besideButtons || onSearch || onSettings ? (
      <View style={styles.headerActions}>
        {besideButtons}
        {onSearch ? <HeaderButton icon="search" label="Search" onPress={onSearch} /> : null}
        {onSettings ? <GearButton onPress={onSettings} /> : null}
      </View>
    ) : null;

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
      {backLabel ? (
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
            <Text style={styles.backLabel}>{backLabel}</Text>
          </Pressable>
          {actions}
        </View>
      ) : null}
      {eyebrowRow ? (
        <View style={[styles.headerTopRow, styles.eyebrowRow]}>
          <Text style={type.eyebrow}>{eyebrow}</Text>
          {accessory}
        </View>
      ) : null}

      <View style={styles.headerMain}>
        <View style={styles.headerText}>
          {eyebrow && !eyebrowRow ? <Text style={[type.eyebrow, styles.eyebrow]}>{eyebrow}</Text> : null}
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {sparkle ? (
              <Sparkle size={26} style={sparkleAtEnd ? styles.titleSparkleEnd : styles.titleSparkle} />
            ) : null}
          </View>
        </View>
        {/* Without a back row, the buttons sit level with the title, as on the Library landing. */}
        {actions && !backLabel ? (
          <View style={eyebrow ? styles.gearBesideTitle : undefined}>{actions}</View>
        ) : null}
      </View>
      {/* Full width, under the gear too, so a one-line subtitle stays one line. */}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

export function GearButton({ onPress }: { onPress: () => void }) {
  return <HeaderButton icon="settings-outline" label="Settings" onPress={onPress} />;
}

function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={colors.ink} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// PhotoCard
// ---------------------------------------------------------------------------

/**
 * A full-width rounded photo with its name over a soft paper-coloured scrim on
 * the left, a white chevron disc bottom-right, and an optional pencil top-right.
 * Without a photo it's a warm empty card, so a missing cover never looks broken.
 */
export function PhotoCard({
  title,
  subtitle,
  imageUrl,
  onPress,
  onEdit,
  editLabel = "Change photo",
  height = 170,
  backdrop,
  busy = false,
  style,
}: {
  title: string;
  subtitle?: string | null;
  /** Relative API paths are resolved with mediaUrl. */
  imageUrl?: string | null;
  onPress: () => void;
  /** Shows the pencil button top-right. */
  onEdit?: () => void;
  editLabel?: string;
  height?: number;
  /** Drawn instead of the photo when there's no `imageUrl` (e.g. a child's monogram). */
  backdrop?: ReactNode;
  /** Swaps the pencil for a spinner while a new photo uploads. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const gradientId = `scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const uri = mediaUrl(imageUrl);
  // The pencil is the card's sibling, not its child: a button inside a button
  // is invalid on the web and steals the card's press on native.
  return (
    <View style={[styles.photoCardShell, { height }, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        style={({ pressed }) => [styles.photoCard, pressed && styles.cardPressed]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} />
        ) : (
          backdrop
        )}
        {/* Paper fading in from the left and the bottom, so ink type reads over any photo. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`${gradientId}-x`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0.92} />
              <Stop offset="0.38" stopColor={colors.bg} stopOpacity={0.6} />
              <Stop offset="0.7" stopColor={colors.bg} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id={`${gradientId}-y`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.45" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId}-x)`} />
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId}-y)`} />
        </Svg>

        <View style={styles.photoCardText}>
          <Text style={styles.photoCardTitle} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.photoCardSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={styles.chevronDisc}>
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </View>
      </Pressable>

      {onEdit ? (
        <Pressable
          onPress={onEdit}
          disabled={busy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={editLabel}
          accessibilityState={{ busy }}
          style={({ pressed }) => [styles.pencil, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : (
            <Ionicons name="pencil" size={15} color={colors.ink} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SearchField
// ---------------------------------------------------------------------------

/** A pill-outlined search box. Filtering is the caller's job. */
export function SearchField({
  value,
  onChangeText,
  placeholder = "Search…",
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.search, style]}>
      <Ionicons name="search" size={20} color={colors.ink} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText("")}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ListRow
// ---------------------------------------------------------------------------

/**
 * A disc (or any leading element), a serif title, a sans description, a
 * chevron, and a hairline under the text. Pass `divider={false}` on the last row.
 */
export function ListRow({
  title,
  description,
  leading,
  onPress,
  divider = true,
  trailing,
}: {
  title: string;
  description?: string | null;
  /** Usually an <IconDisc />. */
  leading?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
  /** Replaces the chevron. */
  trailing?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {leading ? <View style={styles.rowLeading}>{leading}</View> : null}
      <View style={[styles.rowBody, divider && styles.rowDivider]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {title}
          </Text>
          {description ? (
            <Text style={styles.rowDescription} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={colors.inkSoft} /> : null)}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

/** Centres journey content at phone width on a wide browser. */
export function Column({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.column, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  column: { width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", paddingHorizontal: spacing.xl },

  disc: { alignItems: "center", justifyContent: "center" },

  header: { paddingBottom: spacing.lg },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    minHeight: 44,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -4 },
  backLabel: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink },
  gear: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  headerMain: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headerText: { flex: 1 },
  eyebrow: { marginBottom: spacing.xs },
  /** Close to the title, as the eyebrow is when it sits alone. */
  eyebrowRow: { marginBottom: spacing.xs, gap: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "flex-start" },
  title: {
    fontFamily: fonts.display,
    fontSize: 46,
    lineHeight: 52,
    letterSpacing: -0.6,
    color: colors.ink,
    flexShrink: 1,
  },
  titleSparkle: { marginLeft: 6, marginTop: 2 },
  /** Level with the title rather than the eyebrow above it. */
  gearBesideTitle: { marginTop: spacing.md + 2 },
  titleSparkleEnd: { marginLeft: "auto", paddingLeft: spacing.md, marginTop: 4 },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 16.5,
    lineHeight: 23,
    color: colors.inkSoft,
    marginTop: spacing.xs,
  },

  // Measured off design/mockups/01 and 02 (≈2.07 px per pt).
  photoCardShell: { width: "100%", borderRadius: 14, backgroundColor: colors.surfaceAlt, ...shadow },
  photoCard: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.995 }] },
  photoCardText: {
    paddingLeft: spacing.lg,
    paddingRight: 72,
    paddingBottom: spacing.lg,
  },
  photoCardTitle: {
    fontFamily: fonts.display,
    fontSize: 33,
    lineHeight: 38,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  photoCardSubtitle: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 20, color: colors.inkSoft },
  chevronDisc: {
    position: "absolute",
    pointerEvents: "none",
    right: spacing.md,
    bottom: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
  },
  pencil: {
    position: "absolute",
    top: spacing.sm + 2,
    right: spacing.sm + 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
  },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: 52,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  searchInput: {
    flex: 1,
    // The web draws a focus ring on the input inside the pill; the pill is the field.
    outlineWidth: 0,
    height: "100%",
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink,
  },

  // The mockup's rhythm (03): discs nearly touching, about 58pt a row.
  row: { flexDirection: "row", alignItems: "stretch", gap: spacing.lg },
  rowLeading: { justifyContent: "center", paddingVertical: 3 },
  rowBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  rowTitle: { fontFamily: fonts.display, fontSize: 20, lineHeight: 25, color: colors.ink },
  rowDescription: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 19,
    color: colors.inkSoft,
    marginTop: 1,
  },
});
