import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  apiGet,
  type Collection,
  type MemoryCard,
  type Person,
} from "../src/api";
import { AppHeader, Avatar, EmptyState, MemoryRow, Screen } from "../src/components/ui";
import { openInLibrary, routes } from "../src/routes";
import { Ionicons } from "../src/styled";

type Results = { q: string; memories: MemoryCard[]; people: Person[]; collections: Collection[]; total: number };

const SUGGESTIONS = ["moon", "Grandma", "first", "Bear Lake", "laugh"];

/**
 * One search across the whole archive — memories, transcripts, people, places.
 * Semantic search is a later conversation; this is honest keyword matching.
 */
export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);

  const changeQuery = (next: string) => {
    setQuery(next);
    if (next.trim().length < 2) setResults(null);
  };

  useEffect(() => {
    if (query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiGet<Results>(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!cancelled) setResults(data);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

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

        {!results ? (
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
            title={searching ? "Looking…" : "Nothing found"}
            body={searching ? undefined : `No memories match "${results.q}" yet.`}
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
