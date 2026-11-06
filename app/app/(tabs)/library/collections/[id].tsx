import { useLocalSearchParams } from "expo-router";
import { ArchiveScreen } from "../../../../src/components/collection-archive";

/** One collection's archive. */
export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ArchiveScreen path={`/api/collections/${id}`} />;
}
