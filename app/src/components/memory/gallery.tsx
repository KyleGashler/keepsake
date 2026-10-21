import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mediaUrl, type MediaItem } from "../../api";
import { duration } from "../../format";
import { colors, fonts, radius, spacing } from "../../theme";
import { VideoStill } from "./video-still";

/** Tiles in the row; the last becomes "+N" when there are more. */
const TILES = 4;
const GAP = spacing.sm;

/**
 * "Media": every photo and video on the memory as a row of square tiles —
 * videos with a play glyph and their length — the fourth turning into "+N"
 * when there are more. Any tile opens the full-screen viewer there.
 */
export function MediaGallery({ items, onOpen }: { items: MediaItem[]; onOpen: (index: number) => void }) {
  const [width, setWidth] = useState(0);
  const size = width > 0 ? (width - GAP * (TILES - 1)) / TILES : 0;
  const overflow = items.length > TILES ? items.length - (TILES - 1) : 0;
  const shown = overflow ? items.slice(0, TILES - 1) : items.slice(0, TILES);

  return (
    <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {size > 0
        ? shown.map((item, i) => (
            <Pressable
              key={item.id}
              onPress={() => onOpen(i)}
              accessibilityRole="button"
              accessibilityLabel={`${item.type === "VIDEO" ? "Video" : "Photo"} ${i + 1} of ${items.length}`}
              style={({ pressed }) => [styles.tile, { width: size, height: size }, pressed && styles.pressed]}
            >
              <Thumb item={item} />
              {item.type === "VIDEO" ? (
                <View style={styles.videoBadge} pointerEvents="none">
                  <View style={styles.playDisc}>
                    <Ionicons name="play" size={14} color="#fff" style={{ marginLeft: 2 }} />
                  </View>
                  {item.durationS ? <Text style={styles.duration}>{duration(item.durationS)}</Text> : null}
                </View>
              ) : null}
            </Pressable>
          ))
        : null}
      {size > 0 && overflow ? (
        <Pressable
          onPress={() => onOpen(TILES - 1)}
          accessibilityRole="button"
          accessibilityLabel={`${overflow} more — open the viewer`}
          style={({ pressed }) => [styles.tile, styles.more, { width: size, height: size }, pressed && styles.pressed]}
        >
          <Text style={styles.moreLabel}>+{overflow}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A photo, or a video's still. */
export function Thumb({ item }: { item: MediaItem }) {
  if (item.type === "VIDEO") return <VideoStill uri={mediaUrl(item.url)} />;
  return (
    <Image
      source={{ uri: mediaUrl(item.url) }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={200}
      recyclingKey={item.id}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: GAP, minHeight: 60 },
  tile: { borderRadius: radius.sm - 2, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  pressed: { opacity: 0.8 },
  videoBadge: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  playDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#fff",
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  duration: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowRadius: 3,
  },
  more: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt },
  moreLabel: { fontFamily: fonts.sansSemiBold, fontSize: 17, color: colors.inkSoft },
});
