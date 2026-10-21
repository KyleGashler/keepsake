import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type ChildPayload } from "../../../../src/api";
import { Column, IconDisc, ListRow, PageHeader, SearchField } from "../../../../src/components/journey";
import { ErrorState, Loading } from "../../../../src/components/ui";
import { childAge, count, possessive } from "../../../../src/format";
import { routes } from "../../../../src/routes";
import { colors, fonts, spacing } from "../../../../src/theme";

/**
 * One child's collections. A stub that proves the route, the data and the
 * primitives — L3 builds the real header (photo, gear → edit sheet) and the
 * Create a Collection sheet.
 */
export default function ChildCollectionsScreen() {
  const { id: childId } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<ChildPayload>(`/api/children/${childId}`);
  const [query, setQuery] = useState("");
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const needle = query.trim().toLowerCase();
  const collections = (data?.collections ?? []).filter(
    (c) =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      (c.description ?? "").toLowerCase().includes(needle),
  );
  const child = data?.child;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          backLabel="Child Profiles"
          backFallback={routes.children}
          title={child?.name ?? "Collections"}
          subtitle={
            child
              ? [
                  childAge(child.birthDate),
                  count(child.collectionCount, "Collection"),
                  count(child.memoryCount, "Memory", "Memories"),
                ]
                  .filter(Boolean)
                  .join("  •  ")
              : undefined
          }
        />
        {error ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading /> : null}
        {child ? (
          <>
            <Text style={styles.sectionTitle}>Collections</Text>
            <Text style={styles.sectionSubtitle}>
              Different parts of {possessive(child.name)} story, beautifully saved.
            </Text>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search collections…"
              style={styles.search}
            />
            <View>
              {collections.map((collection, i) => (
                <ListRow
                  key={collection.id}
                  title={collection.name}
                  description={collection.description}
                  leading={<IconDisc icon={collection.icon} color={collection.color} />}
                  divider={i < collections.length - 1}
                  onPress={() => router.push(routes.collection(collection.id))}
                />
              ))}
            </View>
          </>
        ) : null}
      </Column>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  sectionTitle: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, color: colors.ink },
  sectionSubtitle: { fontFamily: fonts.sans, fontSize: 16.5, lineHeight: 23, color: colors.inkSoft },
  search: { marginTop: spacing.lg, marginBottom: spacing.sm },
});
