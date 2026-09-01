import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaUrl, type MemoryCard as MemoryCardType, type Person } from "../api";
import { shortDate } from "../format";
import { colors, radius, shadow, spacing, type } from "../theme";
import { KeepsakeMark, KeepsakeWordmark } from "./brand";

/** Content is capped so the phone layout stays intact on a wide browser. */
export const MAX_WIDTH = 720;

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
    <View style={[styles.column, padded && { paddingHorizontal: spacing.lg }]}>{children}</View>
  );
  if (!scroll) return <View style={styles.screen}>{body}</View>;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
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
}: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  globalActions?: boolean;
  /** Primary logo, in place of the label/title pair. Home only. */
  wordmark?: boolean;
  /** The K mark, alongside the label/title pair. */
  mark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.headerWrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {back ? (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
              hitSlop={12}
              style={styles.iconButton}
            >
              <Ionicons name="chevron-back" size={20} color={colors.ink} />
            </Pressable>
          ) : null}
          {mark ? <KeepsakeMark size={38} /> : null}
          {wordmark ? (
            <KeepsakeWordmark width={152} />
          ) : (
            <View style={{ flexShrink: 1 }}>
              {subtitle ? <Text style={type.label}>{subtitle}</Text> : null}
              {title ? (
                <Text style={[type.title, { marginTop: subtitle ? 2 : 0 }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
            </View>
          )}
        </View>
        {globalActions ? (
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push("/search")} hitSlop={10} style={styles.iconButton}>
              <Ionicons name="search" size={19} color={colors.ink} />
            </Pressable>
            <Pressable onPress={() => router.push("/family")} hitSlop={10} style={styles.iconButton}>
              <Ionicons name="people-outline" size={19} color={colors.ink} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function SectionHeader({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={type.label}>{label}</Text>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {content}
    </Pressable>
  );
}

export function Avatar({ person, size = 56 }: { person: Person; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: "hidden",
        borderWidth: 1.5,
        borderColor: person.accentColor,
        backgroundColor: colors.surfaceAlt,
      }}
    >
      <Image
        source={{ uri: mediaUrl(person.avatarUrl) }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        transition={200}
      />
    </View>
  );
}

export function PersonChip({ person, onPress }: { person: Person; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.personChip, pressed && styles.pressed]}>
      <Avatar person={person} size={58} />
      <Text style={styles.personName} numberOfLines={1}>
        {person.name}
      </Text>
      <Text style={styles.personRelation} numberOfLines={1}>
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
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
    >
      <View style={[styles.tileImageWrap, { height }]}>
        <Image
          source={{ uri: mediaUrl(memory.heroUrl) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
        />
        {memory.hasAudio ? (
          <View style={styles.tileBadge}>
            <Ionicons name="mic" size={12} color={colors.surface} />
          </View>
        ) : null}
      </View>
      <Text style={styles.tileTitle} numberOfLines={2}>
        {memory.title}
      </Text>
      <Text style={type.caption}>{shortDate(memory.occurredAt)}</Text>
    </Pressable>
  );
}

export function MemoryRow({ memory }: { memory: MemoryCardType }) {
  return (
    <Pressable
      onPress={() => router.push(`/memory/${memory.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Image
        source={{ uri: mediaUrl(memory.heroUrl) }}
        style={styles.rowImage}
        contentFit="cover"
        transition={200}
      />
      <View style={{ flex: 1 }}>
        <Text style={type.heading} numberOfLines={2}>
          {memory.title}
        </Text>
        <Text style={[type.caption, { marginTop: 2 }]}>
          {shortDate(memory.occurredAt)}
          {memory.location ? ` · ${memory.location}` : ""}
        </Text>
        {memory.excerpt ? (
          <Text style={[type.body, { marginTop: 6, fontSize: 14 }]} numberOfLines={2}>
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
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary";
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && { opacity: 0.45 },
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={17} color={primary ? colors.surface : colors.ink} />
      ) : null}
      <Text style={[styles.buttonLabel, { color: primary ? colors.surface : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label = "Gathering memories…" }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accentDeep} />
      <Text style={[type.caption, { marginTop: spacing.md }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <View style={styles.centered}>
      <Ionicons name="cloud-offline-outline" size={26} color={colors.muted} />
      <Text style={[type.heading, { marginTop: spacing.md }]}>Can't reach the archive</Text>
      <Text style={[type.caption, { textAlign: "center", marginTop: 6 }]}>{error.message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.lg }} /> : null}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={type.heading}>{title}</Text>
      {body ? <Text style={[type.caption, { textAlign: "center", marginTop: 6 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

/** Marks the places where a v0 stub stands in for a real capability. */
export function PreviewNote({ children }: { children: ReactNode }) {
  return (
    <View style={styles.previewNote}>
      <Ionicons name="construct-outline" size={14} color={colors.muted} />
      <Text style={[type.caption, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  column: { width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center" },
  headerWrap: { backgroundColor: colors.bg, paddingBottom: spacing.sm },
  headerRow: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  headerActions: { flexDirection: "row", gap: spacing.xs },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    ...(shadow as object),
  },
  pressed: { opacity: 0.72 },
  personChip: { width: 74, alignItems: "center", gap: 6 },
  personName: { fontSize: 13, fontWeight: "600", color: colors.ink },
  personRelation: { fontSize: 11, color: colors.muted },
  tileImageWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
  },
  tileBadge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(47,54,46,0.62)",
    borderRadius: radius.pill,
    padding: 6,
  },
  tileTitle: { fontFamily: type.heading.fontFamily, fontSize: 16, lineHeight: 21, color: colors.ink },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowImage: { width: 76, height: 76, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 13,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  buttonPrimary: { backgroundColor: colors.accentDeep },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
  centered: { alignItems: "center", justifyContent: "center", paddingVertical: 64, paddingHorizontal: spacing.xl },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: spacing.xl,
  },
  previewNote: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
});
