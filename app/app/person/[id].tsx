import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useApi, type MemoryCard, type Person } from "../../src/api";
import { DreamCloud } from "../../src/components/brand";
import {
  AppHeader,
  Avatar,
  EmptyState,
  ErrorState,
  Loading,
  MemoryRow,
  Screen,
  SectionHeader,
} from "../../src/components/ui";
import { ageFrom } from "../../src/format";
import { colors, radius, spacing, type } from "../../src/theme";

type Payload = {
  person: Person;
  memoryCount: number;
  memories: MemoryCard[];
  collections: { id: string; name: string; pillar: string }[];
};

/** Tapping a person filters the archive around their story. */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<Payload>(`/api/people/${id}`);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const age = ageFrom(data.person.birthDate);

  return (
    <>
      <AppHeader back subtitle={data.person.relation ?? "Family"} title={data.person.name} />
      <Screen>
        <View style={styles.header}>
          <Avatar person={data.person} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={type.title}>{data.person.name}</Text>
            <Text style={type.caption}>
              {[data.person.relation, age].filter(Boolean).join(" · ")}
            </Text>
            <Text style={[type.caption, { marginTop: 4 }]}>
              {data.memoryCount} {data.memoryCount === 1 ? "memory" : "memories"} so far
            </Text>
          </View>
          {/* Whimsical shape 6/6 — dream cloud, over the person the story is about. */}
          <DreamCloud size={44} opacity={0.8} />
        </View>

        {data.collections.length ? (
          <>
            <SectionHeader label="Their collections" />
            <View style={styles.chipWrap}>
              {data.collections.map((collection) => (
                <Pressable
                  key={collection.id}
                  onPress={() => router.push(`/collection/${collection.id}`)}
                  style={styles.chip}
                >
                  <Text style={styles.chipLabel}>{collection.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <SectionHeader label="Memories" />
        {data.memories.length === 0 ? (
          <EmptyState title="No memories yet" body={`Nothing has been filed with ${data.person.name} in it.`} />
        ) : (
          data.memories.map((memory) => <MemoryRow key={memory.id} memory={memory} />)
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: spacing.lg, alignItems: "center", paddingTop: spacing.md },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipLabel: { fontSize: 13, color: colors.ink },
});
