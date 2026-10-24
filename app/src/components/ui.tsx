import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, mediaUrl, type MemoryCard as MemoryCardType, type Person } from "../api";
import { shortDate } from "../format";
import { Image, Ionicons, type IoniconName } from "../styled";
import { layout } from "../theme";
import { BrandMark, Wordmark } from "./brand";


export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // pt-4: with the header's own pb-2, the page header's gap (after-header) above the content.
  const body = (
    <View className={`w-full max-w-page self-center pt-4 ${padded ? "px-gutter" : ""}`}>{children}</View>
  );
  if (!scroll) return <View className="flex-1 bg-paper">{body}</View>;
  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      {body}
    </ScrollView>
  );
}

/**
 * Search and Family Hub live in the top-right corner on every destination,
 * per the product architecture.
 */
export function AppHeader({
  title,
  subtitle,
  back = false,
  globalActions = true,
  wordmark = false,
  mark = false,
  action,
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  globalActions?: boolean;
  /** A screen's own control on the right (a ⋯ menu), before the global ones. */
  action?: ReactNode;
  /** Primary logo, in place of the label/title pair. Home only. */
  wordmark?: boolean;
  /** The K mark, alongside the label/title pair. */
  mark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    // pb-2: room under a pinned header's title before the page scrolls beneath it.
    <View className="bg-paper pb-2" style={{ paddingTop: insets.top + layout.top }}>
      <View className="w-full max-w-page self-center px-gutter flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2 shrink">
          {back ? (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              hitSlop={12}
              className={ICON_BUTTON}
            >
              <Ionicons name="chevron-back" size={20} colorClassName="accent-ink" />
            </Pressable>
          ) : null}
          {mark ? <BrandMark size={38} /> : null}
          {wordmark ? (
            <Wordmark width={152} />
          ) : (
            <View className="shrink">
              {subtitle ? <Text className="type-label">{subtitle}</Text> : null}
              {title ? (
                <Text className={subtitle ? "type-title mt-0.5" : "type-title"} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        {action || globalActions ? (
          <View className="flex-row gap-1">
            {action}
            {globalActions ? (
              <>
                <Pressable onPress={() => router.push("/search")} hitSlop={10} className={ICON_BUTTON}>
                  <Ionicons name="search" size={19} colorClassName="accent-ink" />
                </Pressable>
                <Pressable onPress={() => router.push("/family")} hitSlop={10} className={ICON_BUTTON}>
                  <Ionicons name="people-outline" size={19} colorClassName="accent-ink" />
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ICON_BUTTON = "w-[38px] h-[38px] rounded-full items-center justify-center bg-surface border border-line";

/** A round icon button for AppHeader's `action`, the same as its search and Family Hub buttons. */
export function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} className={ICON_BUTTON}>
      <Ionicons name={icon} size={19} colorClassName="accent-ink" />
    </Pressable>
  );
}

export function SectionHeader({
  label,
  action,
  first = false,
}: {
  label: string;
  action?: ReactNode;
  /** Directly under the page header, which already leaves its own space. */
  first?: boolean;
}) {
  return (
    <View className={`flex-row items-center justify-between mb-3 ${first ? "mt-0" : "mt-section"}`}>
      <Text className="type-label">{label}</Text>
      {action}
    </View>
  );
}

/** A compact pill button, the size of a section header's action. */
export function SmallButton({
  label,
  icon,
  filled = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  icon?: IoniconName;
  filled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      className={`flex-row items-center gap-1 h-8 px-3 rounded-full border active:opacity-70 ${
        filled ? "bg-primary border-primary" : "bg-surface border-line"
      }`}
    >
      {icon ? (
        <Ionicons name={icon} size={15} colorClassName={filled ? "accent-on-primary" : "accent-ink"} />
      ) : null}
      <Text className={`font-sans-bold text-[13.5px] ${filled ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
  className = "",
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
  onPress?: () => void;
}) {
  const content = (
    <View className={`bg-surface rounded-lg border border-line p-4 shadow-card ${className}`} style={style}>
      {children}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} className="active:opacity-72">
      {content}
    </Pressable>
  );
}

export function Avatar({ person, size = 56 }: { person: Person; size?: number }) {
  return (
    <View
      className="overflow-hidden border-[1.5px] bg-surface-alt"
      style={{ width: size, height: size, borderRadius: size / 2, borderColor: person.accentColor }}
    >
      <Image
        source={{ uri: mediaUrl(person.avatarUrl) }}
        className="w-full h-full"
        contentFit="cover"
        transition={200}
      />
      {/* The avatar is a generated orb, so their initials say whose it is. */}
      <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
        <Text
          className="font-sans-bold text-cream tracking-[0.5px]"
          style={{ fontSize: Math.round(size * 0.34) }}
          allowFontScaling={false}
        >
          {person.initials}
        </Text>
      </View>
    </View>
  );
}

export function PersonChip({ person, onPress }: { person: Person; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} className="w-[74px] items-center gap-1.5 active:opacity-72">
      <Avatar person={person} size={58} />
      <Text className="text-[13px] font-semibold text-ink" numberOfLines={1}>
        {person.name}
      </Text>
      <Text className="text-[11px] text-muted" numberOfLines={1}>
        {person.relation ?? ""}
      </Text>
    </Pressable>
  );
}

export function MemoryTile({
  memory,
  width = 210,
  height = 250,
}: {
  memory: MemoryCardType;
  width?: number;
  height?: number;
}) {
  return (
    <Pressable
      onPress={() => router.push(`/memory/${memory.id}`)}
      className="active:opacity-72"
      style={{ width }}
    >
      <View className="rounded-md overflow-hidden bg-surface-alt mb-2" style={{ height }}>
        <Image
          source={{ uri: mediaUrl(memory.heroUrl) }}
          className="absolute inset-0"
          contentFit="cover"
          transition={220}
        />
        {memory.hasAudio ? (
          <View className="absolute top-2 right-2 bg-scrim/62 rounded-full p-1.5">
            <Ionicons name="mic" size={12} colorClassName="accent-surface" />
          </View>
        ) : null}
      </View>
      <Text className="font-display text-[16px] leading-[21px] text-ink" numberOfLines={2}>
        {memory.title}
      </Text>
      <Text className="type-caption">{shortDate(memory.occurredAt)}</Text>
    </Pressable>
  );
}

export function MemoryRow({ memory }: { memory: MemoryCardType }) {
  return (
    <Pressable
      onPress={() => router.push(`/memory/${memory.id}`)}
      className="flex-row gap-3 items-center py-3 border-b border-line active:opacity-72"
    >
      <Image
        source={{ uri: mediaUrl(memory.heroUrl) }}
        className="w-[76px] h-[76px] rounded-sm bg-surface-alt"
        contentFit="cover"
        transition={200}
      />
      <View className="flex-1">
        <Text className="type-heading" numberOfLines={2}>
          {memory.title}
        </Text>
        <Text className="type-caption mt-0.5">
          {shortDate(memory.occurredAt)}
          {memory.location ? ` · ${memory.location}` : ""}
        </Text>
        {memory.excerpt ? (
          <Text className="type-body mt-1.5 text-[14px]" numberOfLines={2}>
            {memory.excerpt}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  style,
  className = "",
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  icon?: IoniconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  className?: string;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-center gap-2 py-[13px] px-6 rounded-full active:opacity-72 ${
        primary ? "bg-primary" : "bg-surface border border-line"
      } ${disabled ? "opacity-45" : ""} ${className}`}
      style={style}
    >
      {icon ? (
        <Ionicons name={icon} size={17} colorClassName={primary ? "accent-surface" : "accent-ink"} />
      ) : null}
      <Text className={`text-[15px] font-semibold ${primary ? "text-surface" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label = "Gathering memories…" }: { label?: string }) {
  return (
    <View className={CENTERED}>
      <ActivityIndicator colorClassName="accent-primary" />
      <Text className="type-caption mt-3">{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  // The API's own message names a status and a request path — useful in a
  // log, not on a family's screen.
  let detail = error.message;
  if (error instanceof ApiError) detail = `The archive couldn't answer just now (${error.status}).`;
  else if (/failed to fetch|network/i.test(error.message)) detail = "Check your connection and try again.";
  return (
    <View className={CENTERED}>
      <Ionicons name="cloud-offline-outline" size={26} colorClassName="accent-muted" />
      <Text className="type-heading mt-3">Can't reach the archive</Text>
      <Text className="type-caption text-center mt-1.5">{detail}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} className="mt-4" /> : null}
    </View>
  );
}

/**
 * A 404 from a screen opened by id: the thing was deleted, belongs to another
 * family, or the link is stale. Not an outage, so no retry — just a way back.
 */
export function NotFoundState({
  title,
  body = "It may have been removed, or the link is out of date.",
  backLabel,
  onBack,
}: {
  title: string;
  body?: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <View className={CENTERED} accessibilityRole="summary">
      <Ionicons name="leaf-outline" size={26} colorClassName="accent-muted" />
      <Text className="type-title mt-3 text-center">{title}</Text>
      <Text className="type-caption text-center mt-1.5">{body}</Text>
      <Button label={backLabel} variant="secondary" icon="chevron-back" onPress={onBack} className="mt-4" />
    </View>
  );
}

/**
 * A screen for adding to the archive, reached by someone whose role only lets
 * them look (a VIEWER, by a link or a stale tab). Says so, and offers a way out.
 */
export function ViewOnlyState({ onBack }: { onBack: () => void }) {
  return (
    <View className={CENTERED} accessibilityRole="summary">
      <Ionicons name="eye-outline" size={26} colorClassName="accent-muted" />
      <Text className="type-title mt-3 text-center">You can look, not add</Text>
      <Text className="type-caption text-center mt-1.5">
        Your role in this family lets you see everything in the archive. An owner can let you add memories from
        Family Hub.
      </Text>
      <Button label="Back to Home" variant="secondary" icon="chevron-back" onPress={onBack} className="mt-4" />
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View className="items-center py-12 px-6">
      <Text className="type-heading">{title}</Text>
      {body ? <Text className="type-caption text-center mt-1.5">{body}</Text> : null}
      {action ? <View className="mt-4">{action}</View> : null}
    </View>
  );
}

/** Marks the places where a v0 stub stands in for a real capability. */
export function PreviewNote({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-2 items-center bg-surface-alt rounded-md p-3 mt-4">
      <Ionicons name="construct-outline" size={14} colorClassName="accent-muted" />
      <Text className="type-caption flex-1">{children}</Text>
    </View>
  );
}

const CENTERED = "items-center justify-center py-16 px-6";
