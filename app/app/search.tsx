import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  apiGet,
  type Collection,
  type MemoryCard,
  type Person,
} from "../src/api";
import { AppHeader, Avatar, EmptyState, MemoryRow, Screen } from "../src/components/ui";
import { openInLibrary, routes } from "../src/routes";
import { colors, radius, spacing, type } from "../src/theme";

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
        <View style={styles.field}>
          <Ionicons name="search" size={17} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={changeQuery}
            autoFocus
            placeholder="A person, a place, something someone said…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => changeQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={17} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        {!results ? (
          <View style={{ marginTop: spacing.xl }}>
            <Text style={type.label}>Try</Text>
            <View style={styles.chipWrap}>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable key={suggestion} onPress={() => changeQuery(suggestion)} style={styles.chip}>
                  <Text style={styles.chipLabel}>{suggestion}</Text>
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
              <View style={{ marginTop: spacing.xl }}>
                <Text style={type.label}>People</Text>
                <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                  {results.people.map((person) => (
                    <Pressable
                      key={person.id}
                      onPress={() => router.push(`/person/${person.id}`)}
                      style={styles.personRow}
                    >
                      <Avatar person={person} size={38} />
                      <Text style={{ fontSize: 15, color: colors.ink }}>
                        {person.name}
                        {person.relation ? ` · ${person.relation}` : ""}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {results.collections.length ? (
              <View style={{ marginTop: spacing.xl }}>
                <Text style={type.label}>Collections</Text>
                <View style={styles.chipWrap}>
                  {results.collections.map((collection) => (
                    <Pressable
                      key={collection.id}
                      onPress={() => openInLibrary(routes.collection(collection.id))}
                      style={styles.chip}
                    >
                      <Text style={styles.chipLabel}>
                        {collection.personName ? `${collection.personName} · ` : ""}
                        {collection.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {results.memories.length ? (
              <View style={{ marginTop: spacing.xl }}>
                <Text style={type.label}>Memories</Text>
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

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 11,
    marginTop: spacing.sm,
  },
  input: { flex: 1, fontSize: 15.5, color: colors.ink },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipLabel: { fontSize: 13.5, color: colors.ink },
  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
