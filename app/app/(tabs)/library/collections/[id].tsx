import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isNotFound, type CollectionArchivePayload } from "../../../../src/api";
import { archivePath, NO_FILTERS, type ArchiveFilters } from "../../../../src/archive";
import { CollectionArchive } from "../../../../src/components/collection-archive";
import { ErrorState, Loading, NotFoundState } from "../../../../src/components/ui";
import { useApiQuery, useRefreshOnFocus } from "../../../../src/query";
import { goBackOr, routes } from "../../../../src/routes";

/**
 * One collection's archive. The filters live here, in the screen, so a memory
 * opened from a filtered list comes back to the same filters (and scroll):
 * memory detail is pushed over the tabs and this screen stays mounted.
 */
export default function CollectionScreen() {
  const { id: collectionId } = useLocalSearchParams<{ id: string }>();
  const [filters, setFilters] = useState<ArchiveFilters>(NO_FILTERS);
  const path = archivePath(collectionId, filters);
  // New filters keep the last list up (dimmed) until their answer is in.
  const query = useApiQuery<CollectionArchivePayload>(path, { keepPrevious: true });
  const { data, error } = query;
  const insets = useSafeAreaInsets();

  // Back from a memory (edited, moved, deleted) or from Capture: those writes
  // mark this stale and it refreshes in place; this catches everyone else's.
  useRefreshOnFocus(query);

  // Checked before `data`: a collection removed while a memory was open
  // 404s on the refresh back here, and the stale list shouldn't stay up.
  if (isNotFound(error)) {
    return (
      <View className="flex-1 justify-center bg-paper" style={{ paddingTop: insets.top }}>
        <NotFoundState
          title="This collection isn't here anymore"
          backLabel="Go back"
          onBack={() => goBackOr(routes.library)}
        />
      </View>
    );
  }

  if (!data) {
    return (
      <View className="flex-1 justify-center bg-paper">
        {error ? (
          <ErrorState error={error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <Loading />
        )}
      </View>
    );
  }

  return (
    <CollectionArchive
      data={data}
      filters={filters}
      onFiltersChange={setFilters}
      loading={query.isPlaceholderData}
      // Hidden while a retry is in flight, so the line doesn't sit there unchanged.
      error={query.isFetching ? null : error}
      onRetry={() => void query.refetch()}
    />
  );
}
