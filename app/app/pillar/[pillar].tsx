import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { mediaUrl, useApi, type Collection, type LibraryPayload, type PillarKey } from "../../src/api";
import { AppHeader, Avatar, ErrorState, Loading, Screen, SectionHeader } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * Arrival Stories and Child Profiles are read one child at a time; Family Life
 * belongs to everyone. Everything below that point is the same pattern.
 */
export default function PillarScreen() {
  const { pillar } = useLocalSearchParams<{ pillar: PillarKey }>();
  const library = useApi<LibraryPayload>("/api/library");
  const [personId, setPersonId] = useState<string | null>(null);

  const meta = library.data?.pillars.find((p) => p.key === pillar);
  const children = library.data?.children ?? [];
  const activePerson = meta?.selectsPerson ? personId ?? children[0]?.id ?? null : null;

  const query = `/api/collections?pillar=${pillar}${activePerson ? `&personId=${activePerson}` : ""}`;
  const collections = useApi<{ collections: Collection[] }>(library.data ? query : null);

  if (library.error) return <ErrorState error={library.error} onRetry={library.refetch} />;
  if (!library.data || !meta) return <Loading />;

  return (
    <>
      <AppHeader back subtitle="Library" title={meta.name} />
      <Screen>
        <Text style={type.body}>{meta.description}</Text>

        {meta.selectsPerson ? (
          <>
            <SectionHeader label="Select a child" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {children.map((child) => {
                const selected = child.id === activePerson;
                return (
                  <Pressable
                    key={child.id}
                    onPress={() => setPersonId(child.id)}
                    style={[styles.childChip, selected && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                  >
                    <Avatar person={child} size={38} />
                    <Text style={styles.childName}>{child.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}

        <SectionHeader label="Collections" />
        {collections.loading && !collections.data ? (
          <Loading label="Opening collections…" />
        ) : (
          <View style={styles.grid}>
            {(collections.data?.collections ?? []).map((collection) => (
              <Pressable
                key={collection.id}
                onPress={() => router.push(`/collection/${collection.id}`)}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
              >
                <Image
                  source={{ uri: mediaUrl(collection.coverUrl) }}
                  style={styles.cover}
                  contentFit="cover"
                  transition={220}
                />
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {collection.name}
                </Text>
                <Text style={type.caption}>
                  {collection.memoryCount === 0
                    ? "Nothing here yet"
                    : `${collection.memoryCount} ${collection.memoryCount === 1 ? "memory" : "memories"}`}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  childChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  childName: { fontSize: 14.5, fontWeight: "600", color: colors.ink, paddingRight: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  card: { width: "47%", flexGrow: 1, maxWidth: 320 },
  cover: {
    width: "100%",
    height: 118,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
  },
  cardTitle: { fontFamily: type.heading.fontFamily, fontSize: 16.5, color: colors.ink },
});
