import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useApi,
  type ChildrenPayload,
  type Collection,
  type LibraryPayload,
  type PillarKey,
} from "../../../../src/api";
import { Column, IconDisc, ListRow, PageHeader } from "../../../../src/components/journey";
import { Avatar, EmptyState, ErrorState, Loading } from "../../../../src/components/ui";
import { count } from "../../../../src/format";
import { routes } from "../../../../src/routes";
import { layout } from "../../../../src/theme";

/**
 * Arrival Stories and Family Life — minimally restyled until their own pass.
 * Arrival Stories is read one child at a time; Family Life belongs to everyone.
 * (Child Profiles has its own screens under children/.)
 */
export default function PillarScreen() {
  const { pillar } = useLocalSearchParams<{ pillar: PillarKey }>();
  const insets = useSafeAreaInsets();
  const library = useApi<LibraryPayload>("/api/library");
  const selectsChild = pillar === "ARRIVAL_STORIES";
  const children = useApi<ChildrenPayload>(selectsChild ? "/api/children" : null);
  const [picked, setPicked] = useState<string | null>(null);

  const meta = library.data?.pillars.find((p) => p.key === pillar);
  const kids = children.data?.children ?? [];
  const personId = selectsChild ? (picked ?? kids[0]?.id ?? null) : null;
  // Arrival Stories waits for a child to be chosen; Family Life loads straight away.
  const ready = !selectsChild || personId !== null;

  const collections = useApi<{ collections: Collection[] }>(
    ready ? `/api/collections?pillar=${pillar}${personId ? `&personId=${personId}` : ""}` : null,
  );

  if (library.error) return <ErrorState error={library.error} onRetry={library.refetch} />;
  if (!meta) return <Loading />;

  const list = collections.data?.collections ?? [];

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader backLabel="Library" title={meta.name} subtitle={meta.tagline} />

        {selectsChild && kids.length > 1 ? (
          // Chips scroll edge to edge on a narrow phone, past the column's gutter.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-gutter mb-4 grow-0"
            contentContainerClassName="gap-2 px-gutter"
          >
            {kids.map((child) => {
              const selected = child.id === personId;
              return (
                <Pressable
                  key={child.id}
                  onPress={() => setPicked(child.id)}
                  accessibilityState={{ selected }}
                  className={`flex-row items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 ${
                    selected ? "border-primary bg-primary" : "border-line"
                  }`}
                >
                  <Avatar person={child} size={32} />
                  <Text className={`font-sans-semibold text-[14.5px] ${selected ? "text-on-primary" : "text-ink"}`}>{child.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {selectsChild && children.data && kids.length === 0 ? (
          <EmptyState title="No children yet" body="Arrival stories begin when a child joins the family." />
        ) : null}
        {collections.loading && !collections.data && ready ? <Loading label="Opening collections…" /> : null}
        <View>
          {list.map((collection, i) => (
            <ListRow
              key={collection.id}
              title={collection.name}
              description={
                collection.memoryCount === 0
                  ? "Nothing here yet"
                  : count(collection.memoryCount, "memory", "memories")
              }
              leading={<IconDisc icon={collection.icon} color={collection.color} />}
              divider={i < list.length - 1}
              onPress={() => router.push(routes.collection(collection.id))}
            />
          ))}
        </View>
      </Column>
    </ScrollView>
  );
}
