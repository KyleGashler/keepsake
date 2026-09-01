import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { mediaUrl, useApi, type MosaicTile } from "../../src/api";
import { StardustCluster } from "../../src/components/brand";
import { AppHeader, ErrorState, Loading, MAX_WIDTH, Screen } from "../../src/components/ui";
import { colors, radius, spacing, type } from "../../src/theme";

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

  const contentWidth = Math.min(width, MAX_WIDTH) - spacing.lg * 2;
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

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading label="Arranging the mosaic…" />;

  return (
    <>
      <AppHeader subtitle="Mosaic" title="The whole picture" />
      <Screen>
        {/* Whimsical shape 3/6 — stardust, for the archive scattered by palette. */}
        <View style={styles.intro}>
          <StardustCluster size={46} />
          <Text style={[type.body, { flex: 1 }]}>
            Not by date, not by folder — by how it all feels together.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: GAP }}>
          {columns.map((column, i) => (
            <View key={i} style={{ width: columnWidth, gap: GAP }}>
              {column.tiles.map((tile) => (
                <Pressable
                  key={tile.id}
                  onPress={() => router.push(`/memory/${tile.id}`)}
                  style={({ pressed }) => [
                    styles.tile,
                    { height: tile.height },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Image
                    source={{ uri: mediaUrl(tile.url) }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={260}
                  />
                  {tile.hasAudio ? (
                    <View style={styles.badge}>
                      <Ionicons name="mic" size={11} color={colors.surface} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  tile: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  badge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: "rgba(47,54,46,0.62)",
    borderRadius: radius.pill,
    padding: 5,
  },
});
