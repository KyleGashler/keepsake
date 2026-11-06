import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChildrenPayload, Collection, LibraryPayload, PillarKey } from "../../../../src/api";
import { Column, IconDisc, ListRow, PageHeader } from "../../../../src/components/journey";
import { Avatar, EmptyState, ErrorState, InlineError, Loading } from "../../../../src/components/ui";
import { count } from "../../../../src/format";
import { useApiQuery, useRefreshOnFocus } from "../../../../src/query";
import { routes } from "../../../../src/routes";
import { layout } from "../../../../src/theme";

export default function PillarScreen() {
  const { pillar } = useLocalSearchParams<{ pillar: PillarKey }>();
  const insets = useSafeAreaInsets();
  const library = useApiQuery<LibraryPayload>("/api/library");
  const selectsChild = pillar === "ARRIVAL_STORIES";
  const children = useApiQuery<ChildrenPayload>(selectsChild ? "/api/children" : null);
  const [picked, setPicked] = useState<string | null>(null);

  const meta = library.data?.pillars.find((p) => p.key === pillar);
  const kids = children.data?.children ?? [];
  const personId = selectsChild ? (picked ?? kids[0]?.id ?? null) : null;
  const ready = !selectsChild || personId !== null;

  const collections = useApiQuery<{ collections: Collection[] }>(
    ready ? `/api/collections?pillar=${pillar}${personId ? `&personId=${personId}` : ""}` : null,
    { keepPrevious: true },
  );
  useRefreshOnFocus(collections);

  if (!meta) {
    return (
      <View className="flex-1 justify-center bg-paper">
        {library.error ? (
          <ErrorState error={library.error} onRetry={() => void library.refetch()} retrying={library.isFetching} />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

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

        {children.error && !children.data ? (
          <ErrorState error={children.error} onRetry={() => void children.refetch()} retrying={children.isFetching} />
        ) : null}
        {selectsChild && children.data && kids.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No children yet"
            body="Arrival stories begin when a child joins the family. Add one from Child Profiles."
          />
        ) : null}
        {collections.error && !collections.data ? (
          <ErrorState
            error={collections.error}
            onRetry={() => void collections.refetch()}
            retrying={collections.isFetching}
          />
        ) : null}
        {collections.error && collections.data ? (
          <InlineError error={collections.error} onRetry={() => void collections.refetch()} retrying={collections.isFetching} />
        ) : null}
        {collections.isPending && ready && !collections.error ? <Loading label="Opening collections…" /> : null}
        {collections.data && list.length === 0 ? (
          <EmptyState
            icon="albums-outline"
            title="No collections here yet"
            body={`${meta.name} collections appear here as the family makes them.`}
          />
        ) : null}
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
