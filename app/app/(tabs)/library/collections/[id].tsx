import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useApi, type CollectionArchivePayload } from "../../../../src/api";
import { archivePath, NO_FILTERS, type ArchiveFilters } from "../../../../src/archive";
import { CollectionArchive } from "../../../../src/components/collection-archive";
import { ErrorState, Loading } from "../../../../src/components/ui";
import { colors } from "../../../../src/theme";

/**
 * One collection's archive. The filters live here, in the screen, so a memory
 * opened from a filtered list comes back to the same filters (and scroll):
 * memory detail is pushed over the tabs and this screen stays mounted.
 */
export default function CollectionScreen() {
  const { id: collectionId } = useLocalSearchParams<{ id: string }>();
  const [filters, setFilters] = useState<ArchiveFilters>(NO_FILTERS);
  const path = archivePath(collectionId, filters);
  const { data, error, loading, refetch } = useApi<CollectionArchivePayload>(path);

  // What's on screen was fetched for `shownPath`. The list dims only while new
  // filters load, not for a quiet refresh on return.
  const [shownPath, setShownPath] = useState(path);
  if (!loading && shownPath !== path) setShownPath(path);

  // Back from a memory (edited, moved, deleted) or from Capture: refresh in
  // place. Only on a return — the first focus is the mount, which useApi has
  // already fetched for, and a filter change fetches through the new path.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) void refetchRef.current();
      focusedBefore.current = true;
    }, []),
  );

  if (!data) {
    return (
      <View style={styles.screen}>
        {error ? <ErrorState error={error} onRetry={refetch} /> : <Loading />}
      </View>
    );
  }

  return (
    <CollectionArchive
      data={data}
      filters={filters}
      onFiltersChange={setFilters}
      loading={shownPath !== path}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: "center" },
});
