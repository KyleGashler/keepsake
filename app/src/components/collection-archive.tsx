import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChildSummary, CollectionArchivePayload, MemoryCard, PillarKey } from "../api";
import { useCanContribute } from "../auth/session-context";
import { childAge, count, possessive } from "../format";
import { entryRendererFor, NO_FILTERS, type ArchiveFilters } from "../archive";
import { backTo, routes } from "../routes";
import { colors, fonts, layout, radius, spacing } from "../theme";
import { ChildPortrait } from "./child-header";
import { Column, IconDisc, SearchField, Sparkle } from "./journey";

const PILLAR_NAMES: Record<PillarKey, string> = {
  ARRIVAL_STORIES: "Arrival Stories",
  CHILD_PROFILES: "Child Profiles",
  FAMILY_LIFE: "Family Life",
};

const SEARCH_DEBOUNCE_MS = 300;

const open = (memory: MemoryCard) => router.push(routes.memory(memory.id));

/**
 * One collection's archive (screen 4 of the Library journey): who it belongs
 * to, the collection's disc, name and description, search and year chips,
 * then its memories under year headings, newest first. Each entry is drawn by
 * the renderer for the collection's kind (archive-entries.tsx).
 *
 * Filters are the caller's state, so the caller fetches with them; the
 * archive keeps showing the last payload while the next one loads, so the
 * header never flashes away.
 */
export function CollectionArchive({
  data,
  filters,
  onFiltersChange,
  loading = false,
}: {
  data: CollectionArchivePayload;
  filters: ArchiveFilters;
  onFiltersChange: (filters: ArchiveFilters) => void;
  /** A fetch for new filters (or a refresh) is in flight. */
  loading?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { collection, years, memories } = data;
  const child = data.child ?? null;

  // The box updates as you type; the server hears about it once typing pauses.
  const [text, setText] = useState(filters.q);
  const latest = useRef({ filters, onFiltersChange });
  useEffect(() => {
    latest.current = { filters, onFiltersChange };
  }, [filters, onFiltersChange]);
  useEffect(() => {
    if (text.trim() === latest.current.filters.q.trim()) return;
    const timer = setTimeout(
      () => latest.current.onFiltersChange({ ...latest.current.filters, q: text }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [text]);

  const filtered = filters.q.trim() !== "" || filters.year !== null;
  const isEmpty = memories.length === 0 && !filtered;
  const groups = groupByYear(memories);
  const Entry = entryRendererFor(collection.kind);

  // A VIEWER can't add memories, so the ways in to capture aren't offered.
  const canContribute = useCanContribute();
  const capture = canContribute
    ? () => router.push({ pathname: "/capture/compose", params: { collectionId: collection.id } })
    : undefined;
  const clearFilters = () => {
    setText("");
    onFiltersChange(NO_FILTERS);
  };

  // A child's own collection backs out to their Collections; Arrival Stories
  // and Family Life collections back out to their pillar.
  const ownedByChild = collection.pillar === "CHILD_PROFILES" && child !== null;
  const backLabel = ownedByChild ? child.name : PILLAR_NAMES[collection.pillar];
  const backParent: Href = ownedByChild ? routes.child(child.id) : routes.pillar(collection.pillar);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <View style={{ paddingTop: insets.top + layout.top }}>
          <BackRow label={backLabel} parent={backParent} />

          <View style={styles.discWrap}>
            <IconDisc icon={collection.icon} color={collection.color} size={76} />
            <Sparkle size={22} style={styles.discSparkle} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {collection.name}
          </Text>
          {collection.description ? (
            <Text style={styles.description}>{collection.description}</Text>
          ) : null}
          <Identity child={child} pillar={collection.pillar} memoryCount={collection.memoryCount} />
        </View>

        {isEmpty ? (
          <EmptyCollection child={child} name={collection.name} onCapture={capture} />
        ) : (
          <>
            <SearchField
              value={text}
              onChangeText={setText}
              placeholder="Search memories…"
              style={styles.search}
            />
            <YearChips
              years={years}
              selected={filters.year}
              onSelect={(year) => onFiltersChange({ ...filters, q: text, year })}
              loading={loading}
            />

            <View style={[styles.results, loading && styles.resultsLoading]}>
              {groups.length === 0 ? (
                <NothingMatches q={filters.q} year={filters.year} onClear={clearFilters} />
              ) : (
                groups.map(({ year, memories: inYear }) => (
                  <View key={year} style={styles.group}>
                    <YearHeading year={year} count={inYear.length} />
                    {inYear.map((memory, i) => (
                      <Entry
                        key={memory.id}
                        memory={memory}
                        collection={collection}
                        child={child}
                        onPress={() => open(memory)}
                        isLast={i === inYear.length - 1}
                      />
                    ))}
                  </View>
                ))
              )}
            </View>

            {groups.length > 0 && capture ? (
              <AddCard
                title="Add to this collection"
                subtitle={`Save a new memory to ${collection.name}.`}
                onPress={capture}
              />
            ) : null}
          </>
        )}
      </Column>
    </ScrollView>
  );
}

/**
 * Newest year first; the server already sends memories newest first. Years
 * are local, like the dates the entries show (format.ts reads local time) and
 * like the server's year chips, which archivePath asks for in this device's
 * time zone — so an entry never sits under a year its own date contradicts.
 */
function groupByYear(memories: MemoryCard[]) {
  const groups: { year: number; memories: MemoryCard[] }[] = [];
  for (const memory of memories) {
    const year = new Date(memory.occurredAt).getFullYear();
    const last = groups.at(-1);
    if (last?.year === year) last.memories.push(memory);
    else groups.push({ year, memories: [memory] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function BackRow({ label, parent }: { label: string; parent: Href }) {
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
    </View>
  );
}

/** Whose collection this is — the child's photo, name and age — and how much is in it. */
function Identity({
  child,
  pillar,
  memoryCount,
}: {
  child: ChildSummary | null;
  pillar: PillarKey;
  memoryCount: number;
}) {
  const memories = count(memoryCount, "memory", "memories");
  if (!child) {
    return (
      <View style={styles.identity}>
        <Text style={styles.identityText}>
          <Text style={styles.identityName}>{PILLAR_NAMES[pillar]}</Text>
          {` · ${memories}`}
        </Text>
      </View>
    );
  }
  const age = childAge(child.birthDate);
  return (
    <View style={styles.identity}>
      {/* Their photo, or their monogram — the same face Child Profiles shows, not the generated avatar. */}
      <ChildPortrait child={child} size={30} uri={child.photoUrl} />
      <Text style={styles.identityText} numberOfLines={1}>
        <Text style={styles.identityName}>{child.name}</Text>
        {[age, memories].filter(Boolean).map((part) => ` · ${part}`).join("")}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function YearChips({
  years,
  selected,
  onSelect,
  loading,
}: {
  years: { year: number; count: number }[];
  selected: number | null;
  onSelect: (year: number | null) => void;
  loading: boolean;
}) {
  const total = years.reduce((sum, y) => sum + y.count, 0);
  // A picked year stays on screen even when a search leaves it empty.
  const shown =
    selected !== null && !years.some((y) => y.year === selected)
      ? [
          ...years.filter((y) => y.year > selected),
          { year: selected, count: 0 },
          ...years.filter((y) => y.year < selected),
        ]
      : years;
  return (
    <View style={styles.chipsRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipsScroll}
      >
        <Chip label="All" count={total} selected={selected === null} onPress={() => onSelect(null)} />
        {shown.map(({ year, count: n }) => (
          <Chip
            key={year}
            label={String(year)}
            count={n}
            selected={selected === year}
            onPress={() => onSelect(selected === year ? null : year)}
          />
        ))}
      </ScrollView>
      {loading ? <ActivityIndicator size="small" color={colors.inkSoft} style={styles.spinner} /> : null}
    </View>
  );
}

function Chip({
  label,
  count: n,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count(n, "memory", "memories")}`}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
      <Text style={[styles.chipCount, selected && styles.chipCountSelected]}>{n}</Text>
    </Pressable>
  );
}

function YearHeading({ year, count: n }: { year: number; count: number }) {
  return (
    <View style={styles.yearHeading} accessibilityRole="header">
      <Text style={styles.yearText}>{year}</Text>
      <View style={styles.yearLine} />
      <Text style={styles.yearCount}>{count(n, "memory", "memories")}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty states and the add action
// ---------------------------------------------------------------------------

function EmptyCollection({
  child,
  name,
  onCapture,
}: {
  child: ChildSummary | null;
  name: string;
  /** Absent for someone who can only view: there's nothing for them to do here yet. */
  onCapture?: () => void;
}) {
  return (
    <View style={styles.emptyPanel}>
      <Sparkle size={26} />
      <Text style={styles.emptyTitle}>A page waiting for its first memory</Text>
      {onCapture ? (
        <>
          <Text style={styles.emptyBody}>
            Start {child ? `${possessive(child.name)} ${name}` : name} with a moment worth keeping. It will
            live here, alongside every one that follows.
          </Text>
          <PillButton label="Preserve the first one" icon="add" onPress={onCapture} />
        </>
      ) : (
        <Text style={styles.emptyBody}>Nothing has been saved to {name} yet.</Text>
      )}
    </View>
  );
}

function NothingMatches({ q, year, onClear }: { q: string; year: number | null; onClear: () => void }) {
  const what = [q.trim() ? `“${q.trim()}”` : null, year !== null ? `from ${year}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <View style={styles.nothing}>
      <Text style={styles.emptyTitle}>Nothing matches</Text>
      <Text style={styles.emptyBody}>
        No memories here {q.trim() ? `match ${what}` : what}. Try another word, or see them all.
      </Text>
      <PillButton label="Clear filters" icon="close" variant="outline" onPress={onClear} />
    </View>
  );
}

function PillButton({
  label,
  icon,
  onPress,
  variant = "filled",
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant?: "filled" | "outline";
}) {
  const filled = variant === "filled";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.pill, filled ? styles.pillFilled : styles.pillOutline, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={filled ? colors.onPrimary : colors.ink} />
      <Text style={[styles.pillLabel, { color: filled ? colors.onPrimary : colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

/** The outlined "+" card that closes a list, as "Create a Collection" does on a child's Collections. */
function AddCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.addCard, pressed && styles.pressed]}
    >
      <View style={styles.addCircle}>
        <Ionicons name="add" size={26} color={colors.ink} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addTitle}>{title}</Text>
        <Text style={styles.addSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },

  backRow: { flexDirection: "row", alignItems: "center", minHeight: 44, marginBottom: spacing.md },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: -4 },
  backLabel: { fontFamily: fonts.sans, fontSize: 17, color: colors.ink },

  discWrap: { alignSelf: "flex-start", marginBottom: spacing.lg },
  discSparkle: { position: "absolute", right: -18, top: -6 },
  title: {
    fontFamily: fonts.display,
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 16.5,
    lineHeight: 23,
    color: colors.inkSoft,
    marginTop: spacing.xs,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg },
  identityText: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 15, color: colors.inkSoft },
  identityName: { fontFamily: fonts.sansBold, color: colors.ink },

  search: { marginTop: spacing.xl },
  chipsRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md },
  // Chips scroll edge to edge on a narrow phone, past the column's gutter.
  chipsScroll: { flexGrow: 1, marginHorizontal: -layout.gutter },
  chips: { gap: spacing.sm, paddingHorizontal: layout.gutter },
  spinner: { position: "absolute", right: 0 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontFamily: fonts.sansBold, fontSize: 14.5, color: colors.ink },
  chipLabelSelected: { color: colors.onPrimary },
  chipCount: { fontFamily: fonts.sans, fontSize: 13.5, color: colors.muted },
  chipCountSelected: { color: "rgba(255,255,255,0.72)" },

  results: { marginTop: spacing.sm },
  resultsLoading: { opacity: 0.5 },
  group: { marginTop: spacing.xl },
  yearHeading: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xs },
  yearText: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink },
  yearLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  yearCount: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.muted },

  emptyPanel: {
    alignItems: "center",
    marginTop: spacing.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
  },
  nothing: { alignItems: "center", paddingVertical: spacing.xxl + spacing.lg, paddingHorizontal: spacing.lg },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.md,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 23,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    maxWidth: 340,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 50,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  pillFilled: { backgroundColor: colors.primary },
  pillOutline: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  pillLabel: { fontFamily: fonts.sansBold, fontSize: 16 },

  addCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  addCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  addTitle: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, color: colors.ink },
  addSubtitle: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 20, color: colors.inkSoft, marginTop: 2 },
});
