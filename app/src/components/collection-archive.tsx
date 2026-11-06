import { router, type Href } from "expo-router";
import { useMutation } from "@tanstack/react-query";
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
import { apiSend, isNotFound, type ChildSummary, type CollectionArchivePayload, type MemoryCard, type PillarKey } from "../api";
import { useCanContribute } from "../auth/session-context";
import { childAge, count, deleteCollectionMessage, possessive, refusalMessage } from "../format";
import { COLLECTION_VIEWS, gone, invalidate, useApiQuery, useRefreshOnFocus } from "../query";
import { archivePath, entryRendererFor, NO_FILTERS, type ArchiveFilters } from "../archive";
import { backTo, goBackOr, routes } from "../routes";
import { Ionicons, type IoniconName } from "../styled";
import { layout, SEARCHABLE_LIST } from "../theme";
import { BackRow, ChildPortrait } from "./child-header";
import { FileMemoriesSheet } from "./file-memories-sheet";
import { Column, IconDisc, SearchField, Sparkle } from "./journey";
import { EditCollectionSheet } from "./library-sheets";
import { ActionSheet, type SheetAction } from "./sheet";
import { ErrorState, InlineError, Loading, NotFoundState } from "./ui";

const PILLAR_NAMES: Record<PillarKey, string> = {
  ARRIVAL_STORIES: "Arrival Stories",
  CHILD_PROFILES: "Child Profiles",
  FAMILY_LIFE: "Family Life",
};

const SEARCH_DEBOUNCE_MS = 300;

const open = (memory: MemoryCard) => router.push(routes.memory(memory.id));

export function ArchiveScreen({ path, extra, view }: { path: string; extra?: Record<string, string>; view?: ArchiveView }) {
  const [filters, setFilters] = useState<ArchiveFilters>(NO_FILTERS);
  const query = useApiQuery<CollectionArchivePayload>(archivePath(path, filters, extra), { keepPrevious: true });
  const { data, error } = query;
  const insets = useSafeAreaInsets();

  useRefreshOnFocus(query);

  // Checked before `data`: a collection removed while a memory was open
  // 404s on the refresh back here, and the stale list shouldn't stay up.
  if (isNotFound(error)) {
    return (
      <View className="flex-1 justify-center bg-paper" style={{ paddingTop: insets.top }}>
        <NotFoundState
          title="This collection isn't here anymore"
          backLabel="Go back"
          onBack={() => goBackOr(routes.library)}
        />
      </View>
    );
  }

  if (!data) {
    return (
      <View className="flex-1 justify-center bg-paper">
        {error ? (
          <ErrorState error={error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  return (
    <CollectionArchive
      data={data}
      filters={filters}
      onFiltersChange={setFilters}
      loading={query.isPlaceholderData}
      error={query.isFetching ? null : error}
      onRetry={() => void query.refetch()}
      view={view}
    />
  );
}

export function CollectionArchive({
  data,
  filters,
  onFiltersChange,
  loading = false,
  error = null,
  onRetry,
  view,
}: {
  data: CollectionArchivePayload;
  view?: ArchiveView;
  filters: ArchiveFilters;
  onFiltersChange: (filters: ArchiveFilters) => void;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { collection, years, memories } = data;
  const child = data.child ?? null;

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

  const canContribute = useCanContribute();
  const capture = canContribute
    ? () => router.push({ pathname: "/capture/compose", params: { collectionId: collection.id } })
    : undefined;
  const clearFilters = () => {
    setText("");
    onFiltersChange(NO_FILTERS);
  };

  const ownedByChild = collection.pillar === "CHILD_PROFILES" && child !== null;
  const backLabel =
    view?.backLabel ?? collection.parentName ?? (ownedByChild ? child.name : PILLAR_NAMES[collection.pillar]);
  const ownParent: Href = ownedByChild ? routes.child(child.id) : routes.pillar(collection.pillar);
  const backParent: Href =
    view?.backParent ?? (collection.parentId ? routes.birthday(collection.parentId) : ownParent);
  const title = view?.title ?? collection.name;
  const description = view ? view.description : collection.description;
  const memoryCount = view ? years.reduce((sum, y) => sum + y.count, 0) : collection.memoryCount;

  const [sheet, setSheet] = useState<"menu" | "edit" | "file" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menuActions: SheetAction[] = [
    { label: "Edit collection", icon: "create-outline", onPress: () => setSheet("edit") },
    { label: "Choose its memories", icon: "albums-outline", onPress: () => setSheet("file") },
    { label: "Delete collection", icon: "trash-outline", destructive: true, onPress: () => setSheet("delete") },
  ];
  const deleteCollection = useMutation({
    mutationFn: () => apiSend(`/api/collections/${collection.id}`, "DELETE"),
    onSuccess: () => invalidate(COLLECTION_VIEWS, [gone(`/api/collections/${collection.id}`)]),
  });
  const remove = () =>
    deleteCollection.mutate(undefined, {
      onSuccess: () => backTo(backParent),
      onError: (err) => setNotice(refusalMessage(err, "Couldn't delete it just now. Please try again.")),
    });

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <View style={{ paddingTop: insets.top + layout.top }}>
          <BackRow
            label={backLabel}
            parent={backParent}
            onMore={canContribute && !view ? () => setSheet("menu") : undefined}
            moreLabel="Collection options"
          />

          <View className="mb-4 self-start">
            <IconDisc icon={collection.icon} color={collection.color} size={76} />
            <Sparkle size={22} className="absolute -right-[18px] -top-1.5" />
          </View>
          <Text className="font-display text-[42px] leading-[48px] tracking-[-0.5px] text-ink" accessibilityRole="header">
            {title}
          </Text>
          {description ? (
            <Text className="mt-1 font-sans text-[16.5px] leading-[23px] text-ink-soft">{description}</Text>
          ) : null}
          <Identity child={child} pillar={collection.pillar} memoryCount={memoryCount} />
          {notice ? <Text className="mt-3 font-sans text-[14px] text-terracotta">{notice}</Text> : null}
          {error ? <InlineError error={error} onRetry={onRetry} /> : null}
        </View>

        {isEmpty ? (
          <EmptyCollection child={child} name={title} onCapture={capture} />
        ) : (
          <>
            {memoryCount > SEARCHABLE_LIST ? (
              <>
                <SearchField
                  value={text}
                  onChangeText={setText}
                  placeholder="Search memories…"
                  className="mt-6"
                />
                {years.length > 1 ? (
                  <YearChips
                    years={years}
                    selected={filters.year}
                    onSelect={(year) => onFiltersChange({ ...filters, q: text, year })}
                    loading={loading}
                  />
                ) : null}
              </>
            ) : null}

            <View className={`mt-2 ${loading ? "opacity-50" : ""}`}>
              {groups.length === 0 ? (
                <NothingMatches q={filters.q} year={filters.year} onClear={clearFilters} />
              ) : (
                groups.map(({ year, memories: inYear }) => (
                  <View key={year} className="mt-6">
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
                subtitle={`Save a new memory to ${title}.`}
                onPress={capture}
              />
            ) : null}
          </>
        )}
      </Column>

      <ActionSheet
        visible={sheet === "menu"}
        onClose={() => setSheet((s) => (s === "menu" ? null : s))}
        title={collection.name}
        actions={menuActions}
      />
      <ActionSheet
        visible={sheet === "delete"}
        onClose={() => setSheet((s) => (s === "delete" ? null : s))}
        title={`Delete “${collection.name}”?`}
        subtitle={
          deleteCollectionMessage(collection.memoryCount)
        }
        actions={[{ label: "Delete collection", icon: "trash-outline", destructive: true, onPress: remove }]}
      />
      {sheet === "edit" ? (
        <EditCollectionSheet collection={collection} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "file" ? (
        <FileMemoriesSheet
          collection={collection}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </ScrollView>
  );
}

export type ArchiveView = { title: string; description: string; backLabel: string; backParent: Href };

// Local years, like the server's year chips (archivePath sends this device's time zone),
// so an entry never sits under a year its own date contradicts.
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
      <View className="mt-4 flex-row items-center gap-2">
        <Text className="shrink font-sans text-[15px] text-ink-soft">
          <Text className="font-sans-bold text-ink">{PILLAR_NAMES[pillar]}</Text>
          {` · ${memories}`}
        </Text>
      </View>
    );
  }
  const age = childAge(child.birthDate);
  return (
    <View className="mt-4 flex-row items-center gap-2">
      <ChildPortrait child={child} size={30} uri={child.photoThumbUrl} />
      <Text className="shrink font-sans text-[15px] text-ink-soft" numberOfLines={1}>
        <Text className="font-sans-bold text-ink">{child.name}</Text>
        {[age, memories].filter(Boolean).map((part) => ` · ${part}`).join("")}
      </Text>
    </View>
  );
}

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
  const shown =
    selected !== null && !years.some((y) => y.year === selected)
      ? [
          ...years.filter((y) => y.year > selected),
          { year: selected, count: 0 },
          ...years.filter((y) => y.year < selected),
        ]
      : years;
  return (
    <View className="mt-3 flex-row items-center">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-gutter"
        className="-mx-gutter grow"
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
      {loading ? <ActivityIndicator size="small" colorClassName="accent-ink-soft" className="absolute right-0" /> : null}
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
      className={`h-[38px] flex-row items-center gap-1.5 rounded-full border px-4 active:opacity-70 ${
        selected ? "border-primary bg-primary" : "border-line bg-paper"
      }`}
    >
      <Text className={`font-sans-bold text-[14.5px] ${selected ? "text-on-primary" : "text-ink"}`}>{label}</Text>
      <Text className={`font-sans text-[13.5px] ${selected ? "text-white/72" : "text-muted"}`}>{n}</Text>
    </Pressable>
  );
}

function YearHeading({ year, count: n }: { year: number; count: number }) {
  return (
    <View className="mb-1 flex-row items-center gap-3" accessibilityRole="header">
      <Text className="font-display text-[28px] leading-[34px] text-ink">{year}</Text>
      <View className="flex-1 bg-line" style={{ height: StyleSheet.hairlineWidth }} />
      <Text className="font-sans-semibold text-[13px] text-muted">{count(n, "memory", "memories")}</Text>
    </View>
  );
}

const EMPTY_TITLE = "mt-3 text-center font-display text-[24px] leading-[30px] text-ink";
const EMPTY_BODY = "mt-2 mb-6 max-w-[340px] text-center font-sans text-[15.5px] leading-[23px] text-ink-soft";

function EmptyCollection({
  child,
  name,
  onCapture,
}: {
  child: ChildSummary | null;
  name: string;
  onCapture?: () => void;
}) {
  return (
    <View className="mt-6 items-center rounded-lg bg-surface-alt px-6 py-9">
      <Sparkle size={26} />
      <Text className={EMPTY_TITLE}>A page waiting for its first memory</Text>
      {onCapture ? (
        <>
          <Text className={EMPTY_BODY}>
            Start {child ? `${possessive(child.name)} ${name}` : name} with a moment worth keeping. It will
            live here, alongside every one that follows.
          </Text>
          <PillButton label="Preserve the first one" icon="add" onPress={onCapture} />
        </>
      ) : (
        <Text className={EMPTY_BODY}>Nothing has been saved to {name} yet.</Text>
      )}
    </View>
  );
}

function NothingMatches({ q, year, onClear }: { q: string; year: number | null; onClear: () => void }) {
  const what = [q.trim() ? `“${q.trim()}”` : null, year !== null ? `from ${year}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <View className="items-center px-4 py-[52px]">
      <Text className={EMPTY_TITLE}>Nothing matches</Text>
      <Text className={EMPTY_BODY}>
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
  icon: IoniconName;
  onPress: () => void;
  variant?: "filled" | "outline";
}) {
  const filled = variant === "filled";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`h-[50px] flex-row items-center gap-2 rounded-full px-6 active:opacity-70 ${
        filled ? "bg-primary" : "border border-line bg-paper"
      }`}
    >
      <Ionicons name={icon} size={18} colorClassName={filled ? "accent-on-primary" : "accent-ink"} />
      <Text className={`font-sans-bold text-[16px] ${filled ? "text-on-primary" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

function AddCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="mt-6 flex-row items-center gap-4 rounded-lg border border-line p-4 active:opacity-70"
    >
      <View className="h-[52px] w-[52px] items-center justify-center rounded-full border-[1.5px] border-ink">
        <Ionicons name="add" size={26} colorClassName="accent-ink" />
      </View>
      <View className="flex-1">
        <Text className="font-display text-[21px] leading-[27px] text-ink">{title}</Text>
        <Text className="mt-0.5 font-sans text-[14.5px] leading-[20px] text-ink-soft" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
