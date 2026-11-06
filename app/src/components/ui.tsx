import { router } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, isForbiddenRole, mediaUrl, type MemoryCard as MemoryCardType, type Person } from "../api";
import { shortDate } from "../format";
import { Image, Ionicons, type IoniconName } from "../styled";
import { layout } from "../theme";
import { BrandMark, Wordmark } from "./brand";
import { CardArt } from "./memory/parts";
import { Sparkle } from "./journey";

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
  action?: ReactNode;
  wordmark?: boolean;
  mark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
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
  first?: boolean;
}) {
  return (
    <View className={`flex-row items-center justify-between mb-3 ${first ? "mt-0" : "mt-section"}`}>
      <Text className="type-label">{label}</Text>
      {action}
    </View>
  );
}

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
        <CardArt memory={memory} large />
        {memory.hasAudio && memory.mediaTypes.some((t) => t !== "AUDIO") ? (
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
        source={{ uri: mediaUrl(memory.thumbUrl ?? memory.heroUrl) }}
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
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  icon?: IoniconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  className?: string;
  accessibilityLabel?: string;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
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

function StatePanel({
  mark,
  title,
  body,
  action,
  panel = false,
  role,
}: {
  mark: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  panel?: boolean;
  role?: "alert" | "summary";
}) {
  return (
    <View
      className={`items-center px-6 ${panel ? "my-2 rounded-lg bg-surface-alt py-9" : "justify-center py-16"}`}
      accessibilityRole={role}
    >
      <View
        className={`h-14 w-14 items-center justify-center rounded-full ${panel ? "bg-surface" : "bg-surface-alt"}`}
      >
        {mark}
      </View>
      <Text className="type-title mt-4 text-center">{title}</Text>
      {body ? <Text className="type-body mt-1.5 max-w-[340px] text-center text-ink-soft">{body}</Text> : null}
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}

function describeError(error: Error) {
  if (isForbiddenRole(error)) return error.message;
  if (error instanceof ApiError) return `The archive couldn't answer just now (${error.status}). Please try again.`;
  if (/failed to fetch|network|load failed/i.test(error.message)) return "Check your connection and try again.";
  return error.message || "Something went wrong. Please try again.";
}

export function ErrorState({
  error,
  onRetry,
  retrying = false,
  title = "Can't reach the archive",
}: {
  error: Error;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
}) {
  return (
    <StatePanel
      role="alert"
      mark={<Ionicons name="cloud-offline-outline" size={26} colorClassName="accent-muted" />}
      title={title}
      body={describeError(error)}
      action={
        onRetry ? (
          <Button
            label={retrying ? "Trying…" : "Try again"}
            icon="refresh"
            variant="secondary"
            onPress={onRetry}
            disabled={retrying}
          />
        ) : undefined
      }
    />
  );
}

export function InlineError({
  error,
  onRetry,
  retrying = false,
}: {
  error: Error;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <View className="my-3 flex-row items-center gap-3 rounded-md bg-surface-alt p-3" accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={18} colorClassName="accent-muted" />
      <Text className="type-caption flex-1">{describeError(error)}</Text>
      {onRetry ? (
        <SmallButton label={retrying ? "Trying…" : "Try again"} icon="refresh" onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function QueryError({
  query,
}: {
  query: { error: Error | null; isFetching: boolean; refetch: () => Promise<unknown> };
}) {
  if (!query.error || query.isFetching) return null;
  return <InlineError error={query.error} onRetry={() => void query.refetch()} />;
}

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
    <StatePanel
      role="summary"
      mark={<Ionicons name="leaf-outline" size={26} colorClassName="accent-muted" />}
      title={title}
      body={body}
      action={<Button label={backLabel} variant="secondary" icon="chevron-back" onPress={onBack} />}
    />
  );
}

export function ViewOnlyState({ onBack }: { onBack: () => void }) {
  return (
    <StatePanel
      role="summary"
      mark={<Ionicons name="eye-outline" size={26} colorClassName="accent-muted" />}
      title="You can look, not add"
      body="Your role in this family lets you see everything in the archive. An owner can let you add memories from Family Hub."
      action={<Button label="Back to Home" variant="secondary" icon="chevron-back" onPress={onBack} />}
    />
  );
}

export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: string;
  icon?: IoniconName;
  action?: ReactNode;
}) {
  return (
    <StatePanel
      panel
      role="summary"
      mark={icon ? <Ionicons name={icon} size={24} colorClassName="accent-accent-deep" /> : <Sparkle size={26} variant="filled" />}
      title={title}
      body={body}
      action={action}
    />
  );
}

export function PreviewNote({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row gap-2 items-center bg-surface-alt rounded-md p-3 mt-4">
      <Ionicons name="construct-outline" size={14} colorClassName="accent-muted" />
      <Text className="type-caption flex-1">{children}</Text>
    </View>
  );
}

const CENTERED = "items-center justify-center py-16 px-6";
