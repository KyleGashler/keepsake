import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, SectionList, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Person, TimelineMemory, TimelinePayload } from "../../src/api";
import { useCanContribute } from "../../src/auth/session-context";
import { Column, Sparkle, TabHeader } from "../../src/components/journey";
import { CardArt } from "../../src/components/memory/parts";
import { Button, EmptyState, ErrorState, Loading } from "../../src/components/ui";
import { ageOn, birthdayLabel, count, longDate, monthDay, monthName } from "../../src/format";
import { useApiQuery, useRefreshOnFocus } from "../../src/query";
import { routes } from "../../src/routes";
import { layout, useColor } from "../../src/theme";

type Row =
  | { kind: "month"; key: string; label: string }
  | { kind: "memory"; key: string; memory: TimelineMemory }
  | { kind: "birth"; key: string; child: Person };

type YearSection = { year: number; memoryCount: number; data: Row[] };

export default function TimelineScreen() {
  const timeline = useApiQuery<TimelinePayload>("/api/timeline");
  const { data, error } = timeline;
  useRefreshOnFocus(timeline);
  const canContribute = useCanContribute();
  const insets = useSafeAreaInsets();

  const isEmpty = data?.memories.length === 0;
  const sections = data && !isEmpty ? yearSections(data) : [];
  const kids = new Map(data?.children.map((c) => [c.id, c]));
  const lastKey = sections.at(-1)?.data.at(-1)?.key;

  return (
    <SectionList
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled
      sections={sections}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={
        <Column>
          <TabHeader title="Timeline" subtitle="Every memory, in the order it happened." />
          {error && !data ? (
            <ErrorState error={error} onRetry={() => void timeline.refetch()} retrying={timeline.isFetching} />
          ) : null}
          {timeline.isPending && !error ? <Loading /> : null}
          {isEmpty ? (
            <EmptyState
              icon="git-commit-outline"
              title="The thread starts with one memory"
              body="Every story, photo and voice the family keeps lines up here, from the very first day to this one."
              action={
                canContribute ? (
                  <Button label="Preserve a memory" icon="add" onPress={() => router.push("/capture")} />
                ) : undefined
              }
            />
          ) : null}
        </Column>
      }
      renderSectionHeader={({ section }) => <YearHeader section={section} />}
      renderItem={({ item }) => {
        const isLast = item.key === lastKey;
        if (item.kind === "month") return <MonthRow label={item.label} />;
        if (item.kind === "birth") return <BirthRow child={item.child} isLast={isLast} />;
        return <MemoryRow memory={item.memory} kids={kids} isLast={isLast} />;
      }}
    />
  );
}

function yearSections({ children, memories }: TimelinePayload): YearSection[] {
  const moments: { at: Date; row: Row }[] = [
    ...memories.map((memory) => ({
      at: new Date(memory.occurredAt),
      row: { kind: "memory", key: memory.id, memory } as const,
    })),
    ...children.flatMap((child) =>
      child.birthDate
        ? [{ at: localBirthDay(child.birthDate), row: { kind: "birth", key: `birth-${child.id}`, child } as const }]
        : [],
    ),
  ];
  moments.sort((a, b) => b.at.getTime() - a.at.getTime());

  const sections: YearSection[] = [];
  let current: YearSection | null = null;
  let month = "";
  for (const { at, row } of moments) {
    if (current?.year !== at.getFullYear()) {
      current = { year: at.getFullYear(), memoryCount: 0, data: [] };
      sections.push(current);
      month = "";
    }
    if (monthName(at) !== month) {
      month = monthName(at);
      current.data.push({ kind: "month", key: `${current.year}-${month}`, label: month });
    }
    if (row.kind === "memory") current.memoryCount += 1;
    current.data.push(row);
  }
  return sections;
}

// Birthdays are stored as UTC midnight; this is that calendar day at local midnight, so it sorts
// below any memory from the same day.
function localBirthDay(iso: string) {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function agesLine(memory: TimelineMemory, kids: Map<string, Person>) {
  return memory.childIds
    .flatMap((id) => {
      const child = kids.get(id);
      if (!child) return [];
      const age = ageOn(child.birthDate, memory.occurredAt);
      return [age ? `${child.name}, ${age}` : child.name];
    })
    .join("  ·  ");
}

const RAIL = 28;
const NODE_TOP = 20;

function Rail({ node, isLast = false }: { node?: ReactNode; isLast?: boolean }) {
  return (
    <View className="items-center" style={{ width: RAIL }}>
      <View
        className="absolute top-0 w-[2px] rounded-[1px] bg-line"
        style={isLast ? { height: NODE_TOP } : { bottom: 0 }}
      />
      {node ? (
        <View className="items-center justify-center bg-paper" style={{ marginTop: NODE_TOP - 4, height: 24 }}>
          {node}
        </View>
      ) : null}
    </View>
  );
}

function YearHeader({ section }: { section: YearSection }) {
  return (
    <View className="bg-paper">
      <Column className="flex-row">
        <Rail />
        <View className="flex-1 flex-row items-baseline gap-3 pt-4 pb-1">
          <Text className="font-display text-[30px] leading-[36px] text-ink" accessibilityRole="header">
            {section.year}
          </Text>
          {section.memoryCount ? (
            <Text className="type-caption">{count(section.memoryCount, "memory", "memories")}</Text>
          ) : null}
        </View>
      </Column>
    </View>
  );
}

function MonthRow({ label }: { label: string }) {
  return (
    <Column className="flex-row">
      <Rail />
      <Text className="type-eyebrow pt-4 pb-1">{label}</Text>
    </Column>
  );
}

function MemoryRow({
  memory,
  kids,
  isLast,
}: {
  memory: TimelineMemory;
  kids: Map<string, Person>;
  isLast: boolean;
}) {
  const eyebrow = [monthDay(memory.occurredAt), memory.location].filter(Boolean).join("  ·  ");
  const ages = agesLine(memory, kids);
  return (
    <Pressable
      onPress={() => router.push(routes.memory(memory.id))}
      accessibilityRole="button"
      accessibilityLabel={`${memory.title}, ${longDate(memory.occurredAt)}`}
      className="active:opacity-70"
    >
      <Column className="flex-row">
        <Rail isLast={isLast} node={<View className="h-[11px] w-[11px] rounded-full border-2 border-ink-soft bg-paper" />} />
        <View className="flex-1 flex-row items-start gap-3 py-3 pl-1">
          {memory.isTextOnly ? null : (
            <View className="h-16 w-16 overflow-hidden rounded-md bg-surface-alt">
              <CardArt memory={memory} compact />
            </View>
          )}
          <View className="min-w-0 flex-1">
            <Text className="type-label mb-[3px]" numberOfLines={1}>
              {eyebrow}
            </Text>
            <Text className="font-display text-[19px] leading-[24px] text-ink" numberOfLines={2}>
              {memory.title}
            </Text>
            {memory.isTextOnly && memory.excerpt ? (
              <Text className="mt-1 font-sans text-[14.5px] leading-[21px] text-ink-soft" numberOfLines={2}>
                {memory.excerpt}
              </Text>
            ) : null}
            {ages ? (
              <Text className="type-caption mt-1" numberOfLines={1}>
                {ages}
              </Text>
            ) : null}
          </View>
        </View>
      </Column>
    </Pressable>
  );
}

function BirthRow({ child, isLast }: { child: Person; isLast: boolean }) {
  const accent = useColor("accent");
  return (
    <Column className="flex-row">
      <Rail isLast={isLast} node={<Sparkle size={18} variant="filled" color={accent} />} />
      <View className="flex-1 py-3 pl-1">
        <Text className="font-display text-[19px] leading-[24px] text-ink">{`${child.name} was born`}</Text>
        <Text className="type-caption mt-0.5">{birthdayLabel(child.birthDate)}</Text>
      </View>
    </Column>
  );
}
