import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Collection, MemoryCard, Person } from "../src/api";
import { AppHeader, Avatar, EmptyState, ErrorState, InlineError, MemoryRow, Screen } from "../src/components/ui";
import { useApiQuery } from "../src/query";
import { openInLibrary, routes } from "../src/routes";
import { Ionicons } from "../src/styled";
import { useSettled } from "../src/use-settled";

type Results = { q: string; memories: MemoryCard[]; people: Person[]; collections: Collection[]; total: number };

const SUGGESTIONS = ["moon", "Grandma", "first", "Bear Lake", "laugh"];


/**
 * One search across the whole archive — memories, transcripts, people, places.
 * Semantic search is a later conversation; this is honest keyword matching.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("");
  // The server hears about it once typing pauses; a cleared box stops at once.
  const settled = useSettled(query.trim(), 220);
  const term = query.trim().length >= 2 && settled.length >= 2 ? settled : null;
  const search = useApiQuery<Results>(term ? `/api/search?q=${encodeURIComponent(term)}` : null, {
    // The last results stay up while the next ones load.
    keepPrevious: true,
  });
  const results = term ? (search.data ?? null) : null;
  const searching = search.isFetching;
  const changeQuery = setQuery;

  return (
    <>
      <AppHeader back title="Search" globalActions={false} />
      <Screen>
        <View className="flex-row items-center gap-2 rounded-full border border-line bg-surface px-4 py-[11px]">
          <Ionicons name="search" size={17} colorClassName="accent-muted" />
          <TextInput
            value={query}
            onChangeText={changeQuery}
            autoFocus
            placeholder="A person, a place, something someone said…"
            placeholderTextColorClassName="accent-muted"
            className="flex-1 text-[15.5px] text-ink"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => changeQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} colorClassName="accent-muted" />
            </Pressable>
          ) : null}
        </View>

        {term && search.error && !search.data ? (
          <ErrorState
            title="Search isn't answering"
            error={search.error}
            onRetry={() => void search.refetch()}
            retrying={search.isFetching}
          />
        ) : null}
        {term && search.error && search.data && !search.isFetching ? (
          <InlineError error={search.error} onRetry={() => void search.refetch()} />
        ) : null}

        {!results && !(term && search.error) ? (
          <View className="mt-6">
            <Text className="type-label">Try</Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Pressable key={suggestion} onPress={() => changeQuery(suggestion)} className="rounded-full border border-line bg-surface px-4 py-2">
                  <Text className="text-[13.5px] text-ink">{suggestion}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {results && results.total === 0 ? (
          <EmptyState
            icon="search-outline"
            title={searching ? "Looking…" : "Nothing found"}
            body={searching ? undefined : `Nothing in the archive matches “${results.q}” yet. Try a name, a place, or a word someone said.`}
          />
        ) : null}

        {results && results.total !== 0 ? (
          <>
            {results.people.length ? (
              <View className="mt-6">
                <Text className="type-label">People</Text>
                <View className="mt-3 gap-3">
                  {results.people.map((person) => (
                    <Pressable
                      key={person.id}
                      onPress={() => router.push(`/person/${person.id}`)}
                      className="flex-row items-center gap-3"
                    >
                      <Avatar person={person} size={38} />
                      <Text className="text-[15px] text-ink">
                        {person.name}
                        {person.relation ? ` · ${person.relation}` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {results.collections.length ? (
              <View className="mt-6">
                <Text className="type-label">Collections</Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {results.collections.map((collection) => (
                    <Pressable
                      key={collection.id}
                      onPress={() => openInLibrary(routes.collection(collection.id))}
                      className="rounded-full border border-line bg-surface px-4 py-2"
                    >
                      <Text className="text-[13.5px] text-ink">
                        {collection.personName ? `${collection.personName} · ` : ""}
                        {collection.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {results.memories.length ? (
              <View className="mt-6">
                <Text className="type-label">Memories</Text>
                {results.memories.map((memory) => (
                  <MemoryRow key={memory.id} memory={memory} />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </Screen>
    </>
  );
}
