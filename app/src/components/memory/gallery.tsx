import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { mediaUrl, type MediaItem } from "../../api";
import { duration } from "../../format";
import { Image, Ionicons } from "../../styled";
import { VideoStill } from "./video-still";

/** Tiles in the row; the last becomes "+N" when there are more. */
const TILES = 4;
/** The row's `gap-2`, for sizing the tiles. */
const GAP = 8;

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
    <View className="min-h-[60px] flex-row gap-2" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {size > 0
        ? shown.map((item, i) => (
            <Pressable
              key={item.id}
              onPress={() => onOpen(i)}
              accessibilityRole="button"
              accessibilityLabel={`${item.type === "VIDEO" ? "Video" : "Photo"} ${i + 1} of ${items.length}`}
              className="overflow-hidden rounded-[8px] bg-surface-alt active:opacity-80"
              style={{ width: size, height: size }}
            >
              <Thumb item={item} />
              {item.type === "VIDEO" ? (
                <View className="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex-row items-center justify-between">
                  <View className="h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-white bg-black/35">
                    <Ionicons name="play" size={14} colorClassName="accent-white" className="ml-0.5" />
                  </View>
                  {item.durationS ? (
                    // A scrim like the play disc's rather than a text shadow: react-native-web
                    // warns on the textShadow* longhands, and native has nothing else.
                    <Text className="overflow-hidden rounded-[6px] bg-black/35 px-[5px] font-sans-bold text-[12px] text-white">
                      {duration(item.durationS)}
                    </Text>
                  ) : null}
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
          className="items-center justify-center overflow-hidden rounded-[8px] bg-surface-alt active:opacity-80"
          style={{ width: size, height: size }}
        >
          <Text className="font-sans-semibold text-[17px] text-ink-soft">+{overflow}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A photo, or a video's still. */
export function Thumb({ item }: { item: MediaItem }) {
  if (item.type === "VIDEO") return <VideoStill item={item} />;
  return (
    <Image
      source={{ uri: mediaUrl(item.url) }}
      className="absolute inset-0"
      contentFit="cover"
      transition={200}
      recyclingKey={item.id}
    />
  );
}
