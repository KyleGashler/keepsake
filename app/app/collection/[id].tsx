import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { useApi, type Collection, type MemoryCard } from "../../src/api";
import {
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  MemoryRow,
  Screen,
} from "../../src/components/ui";

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<{ collection: Collection; memories: MemoryCard[] }>(
    `/api/collections/${id}`,
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const { collection, memories } = data;

  return (
    <>
      <AppHeader
        back
        subtitle={collection.personName ?? "Family Life"}
        title={collection.name}
      />
      <Screen>
        {memories.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="This collection is waiting for its first memory."
            action={
              <Button
                label="Preserve the first one"
                icon="add"
                onPress={() =>
                  router.push({ pathname: "/capture/compose", params: { collectionId: collection.id } })
                }
              />
            }
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
              onPress={() =>
                router.push({ pathname: "/capture/compose", params: { collectionId: collection.id } })
              }
              style={{ marginTop: 24, alignSelf: "center" }}
            />
          </>
        )}
      </Screen>
    </>
  );
}
