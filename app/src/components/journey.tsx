import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import { Image, Ionicons, type IoniconName } from "../styled";
import { layout, useColor } from "../theme";
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
  color,
  variant = "outline",
  strokeWidth = 1.6,
  style,
  className,
}: {
  size?: number;
  /** Honey (`accent`) unless given. */
  color?: ColorValue;
  variant?: "outline" | "filled";
  /** Outline weight in viewBox units (24), so it scales with `size`. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  return (
    <Twinkle
      size={size}
      color={color}
      strokeWidth={variant === "outline" ? strokeWidth : undefined}
      style={style}
      className={className}
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
  className = "",
}: {
  icon: string;
  /** Disc colour, hex. */
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  return (
    <View
      className={`items-center justify-center ${className}`}
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
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
      <View className="flex-row gap-2">
        {besideButtons}
        {onSearch ? <HeaderButton icon="search" label="Search" onPress={onSearch} /> : null}
        {onSettings ? <GearButton onPress={onSettings} /> : null}
      </View>
    ) : null;

  return (
    <View className="pb-after-header" style={{ paddingTop: insets.top + layout.top }}>
      {backLabel ? (
        <View className="flex-row items-center justify-between mb-3 min-h-11">
          <Pressable
            onPress={goBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            className="flex-row items-center gap-1 -ml-1 active:opacity-70"
          >
            <Ionicons name="chevron-back" size={22} colorClassName="accent-ink" />
            <Text className="font-sans text-[17px] text-ink">{backLabel}</Text>
          </Pressable>
          {actions}
        </View>
      ) : null}
      {eyebrowRow ? (
        // mb-1: close to the title, as the eyebrow is when it sits alone.
        <View className="flex-row items-center justify-between mb-1 gap-3 min-h-11">
          <Text className="type-eyebrow">{eyebrow}</Text>
          {accessory}
        </View>
      ) : null}

      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          {eyebrow && !eyebrowRow ? <Text className="type-eyebrow mb-1">{eyebrow}</Text> : null}
          <View className="flex-row items-start">
            <Text
              className="font-display text-[46px] leading-[52px] tracking-[-0.6px] text-ink shrink"
              accessibilityRole="header"
            >
              {title}
            </Text>
            {sparkle ? <Sparkle size={26} className={sparkleAtEnd ? "ml-auto pl-3 mt-1" : "ml-1.5 mt-0.5"} /> : null}
          </View>
        </View>
        {/* Without a back row, the buttons sit level with the title (mt-3.5), as on the Library landing. */}
        {actions && !backLabel ? <View className={eyebrow ? "mt-3.5" : undefined}>{actions}</View> : null}
      </View>
      {/* Full width, under the gear too, so a one-line subtitle stays one line. */}
      {subtitle ? <Text className="font-sans text-[16.5px] leading-[23px] text-ink-soft mt-1">{subtitle}</Text> : null}
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
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="w-11 h-11 rounded-full items-center justify-center bg-surface-alt active:opacity-70"
    >
      <Ionicons name={icon} size={22} colorClassName="accent-ink" />
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
  className = "",
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
  className?: string;
}) {
  const paper = useColor("paper");
  const gradientId = `scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const uri = mediaUrl(imageUrl);
  // The pencil is the card's sibling, not its child: a button inside a button
  // is invalid on the web and steals the card's press on native.
  return (
    // Measured off design/mockups/01 and 02 (≈2.07 px per pt).
    <View className={`w-full rounded-[14px] bg-surface-alt shadow-card ${className}`} style={[{ height }, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        className="flex-1 rounded-[14px] overflow-hidden justify-end active:opacity-90 active:scale-[0.995]"
      >
        {uri ? (
          <Image source={{ uri }} className="absolute inset-0" contentFit="cover" transition={250} />
        ) : (
          backdrop
        )}
        {/* Paper fading in from the left and the bottom, so ink type reads over any photo. */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`${gradientId}-x`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={paper} stopOpacity={0.92} />
              <Stop offset="0.38" stopColor={paper} stopOpacity={0.6} />
              <Stop offset="0.7" stopColor={paper} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id={`${gradientId}-y`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.45" stopColor={paper} stopOpacity={0} />
              <Stop offset="1" stopColor={paper} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId}-x)`} />
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId}-y)`} />
        </Svg>

        <View className="pl-4 pr-[72px] pb-4">
          <Text className="font-display text-[33px] leading-[38px] tracking-[-0.5px] text-ink" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="font-sans text-[15px] leading-[20px] text-ink-soft" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View className="absolute pointer-events-none right-3 bottom-4 w-10 h-10 rounded-full bg-surface items-center justify-center shadow-card">
          <Ionicons name="chevron-forward" size={20} colorClassName="accent-ink" />
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
          className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-surface items-center justify-center shadow-card active:opacity-70"
        >
          {busy ? (
            <ActivityIndicator size="small" colorClassName="accent-ink" />
          ) : (
            <Ionicons name="pencil" size={15} colorClassName="accent-ink" />
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
  className = "",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 h-[52px] px-[18px] rounded-full border border-line bg-paper ${className}`}
      style={style}
    >
      <Ionicons name="search" size={20} colorClassName="accent-ink" />
      {/* outline-0: the web draws a focus ring on the input inside the pill; the pill is the field. */}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColorClassName="accent-muted"
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={placeholder}
        className="flex-1 outline-0 h-full font-sans text-[16px] text-ink"
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText("")}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={18} colorClassName="accent-muted" />
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
  // The mockup's rhythm (03): discs nearly touching, about 58pt a row.
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      className="flex-row items-stretch gap-4 active:opacity-70"
    >
      {leading ? <View className="justify-center py-[3px]">{leading}</View> : null}
      <View
        className="flex-1 flex-row items-center gap-3 py-2 border-line"
        style={divider ? { borderBottomWidth: StyleSheet.hairlineWidth } : undefined}
      >
        <View className="flex-1">
          <Text className="font-display text-[20px] leading-[25px] text-ink" numberOfLines={2}>
            {title}
          </Text>
          {description ? (
            <Text className="font-sans text-[14px] leading-[19px] text-ink-soft mt-px" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
        {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={20} colorClassName="accent-ink-soft" /> : null)}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

/** Centres journey content at phone width on a wide browser. */
export function Column({
  children,
  style,
  className = "",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  return (
    <View className={`w-full max-w-page self-center px-gutter ${className}`} style={style}>
      {children}
    </View>
  );
}
