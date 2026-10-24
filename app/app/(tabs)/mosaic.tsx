import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaUrl, useApi, type MosaicTile } from "../../src/api";
import { Column, PageHeader } from "../../src/components/journey";
import { FamilyPill } from "../../src/components/family-switcher";
import { ErrorState, Loading } from "../../src/components/ui";
import { Image, Ionicons } from "../../src/styled";
import { layout, MAX_WIDTH } from "../../src/theme";

const GAP = 10;
const RATIO = { single: 1.15, tall: 1.6, wide: 0.72 } as const;

/**
 * Mosaic is for perspective, not organisation: the archive arranged by how it
 * looks rather than when it happened. The server sorts by palette; here we lay
 * the tiles into columns so the grid keeps a curated rhythm.
 */
export default function MosaicScreen() {
  const { data, error, loading, refetch } = useApi<{ tiles: MosaicTile[] }>("/api/mosaic");
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const contentWidth = Math.min(width, MAX_WIDTH) - layout.gutter * 2;
  const columnCount = contentWidth > 560 ? 3 : 2;
  const columnWidth = (contentWidth - GAP * (columnCount - 1)) / columnCount;

  const columns = useMemo(() => {
    const cols: { tiles: (MosaicTile & { height: number })[]; height: number }[] = Array.from(
      { length: columnCount },
      () => ({ tiles: [], height: 0 }),
    );
    for (const tile of data?.tiles ?? []) {
      const height = Math.round(columnWidth * RATIO[tile.span]);
      // Always feed the shortest column so the bottom edge stays even.
      const target = cols.reduce((a, b) => (a.height <= b.height ? a : b));
      target.tiles.push({ ...tile, height });
      target.height += height + GAP;
    }
    return cols;
  }, [data, columnCount, columnWidth]);

  return (
    <ScrollView
      className="flex-1 bg-paper"
      contentContainerStyle={{ paddingBottom: insets.bottom + layout.bottom }}
      showsVerticalScrollIndicator={false}
    >
      <Column>
        <PageHeader
          eyebrow="Little by little"
          accessory={<FamilyPill />}
          title="Mosaic"
          sparkle
          subtitle="Not by date, not by folder — by how it all feels together."
          onSettings={() => router.push("/family")}
          onSearch={() => router.push("/search")}
        />
        {error && !data ? <ErrorState error={error} onRetry={refetch} /> : null}
        {loading && !data ? <Loading label="Arranging the mosaic…" /> : null}
        <View className="flex-row" style={{ gap: GAP }}>
          {columns.map((column, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- columns are positions; tiles move between them
            <View key={i} style={{ width: columnWidth, gap: GAP }}>
              {column.tiles.map((tile) => (
                <Pressable
                  key={tile.id}
                  onPress={() => router.push(`/memory/${tile.id}`)}
                  className="overflow-hidden rounded-md bg-surface-alt active:opacity-80"
                  style={{ height: tile.height }}
                >
                  <Image
                    source={{ uri: mediaUrl(tile.url) }}
                    className="absolute inset-0"
                    contentFit="cover"
                    transition={260}
                  />
                  {tile.hasAudio ? (
                    <View className="absolute top-2 right-2 rounded-full bg-scrim/62 p-[5px]">
                      <Ionicons name="mic" size={11} colorClassName="accent-surface" />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </Column>
    </ScrollView>
  );
}
