import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, type CollectionArchivePayload } from "../../../../src/api";
import { Column, IconDisc, PageHeader } from "../../../../src/components/journey";
import { Button, EmptyState, ErrorState, Loading, MemoryRow } from "../../../../src/components/ui";
import { routes } from "../../../../src/routes";
import { colors, spacing } from "../../../../src/theme";

/**
 * One collection's archive. A stub that proves the route and the data — L4
 * replaces the body with the reusable CollectionArchive (child header, search,
 * year chips, entries rendered by `collection.kind`).
 */
export default function CollectionScreen() {
  const { id: collectionId } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<CollectionArchivePayload>(
    `/api/collections/${collectionId}`,
  );
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const capture = () =>
    router.push({ pathname: "/capture/compose", params: { collectionId } });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const { collection, memories } = data;
  // `child` is part of the journey contract; older servers don't send it.
  const child = data.child ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          backLabel={child?.name ?? collection.personName ?? "Library"}
          backFallback={child ? routes.child(child.id) : routes.library}
          title={collection.name}
          subtitle={collection.description ?? undefined}
        >
          <IconDisc icon={collection.icon} color={collection.color} size={48} style={styles.disc} />
        </PageHeader>

        {memories.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="This collection is waiting for its first memory."
            action={<Button label="Preserve the first one" icon="add" onPress={capture} />}
          />
        ) : (
          <>
            <View>
              {memories.map((memory) => (
                <MemoryRow key={memory.id} memory={memory} />
              ))}
            </View>
            <Button
              label="Add to this collection"
              variant="secondary"
              icon="add"
              onPress={capture}
              style={styles.add}
            />
          </>
        )}
      </Column>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  disc: { marginTop: spacing.md },
  add: { marginTop: spacing.xl, alignSelf: "center" },
});
