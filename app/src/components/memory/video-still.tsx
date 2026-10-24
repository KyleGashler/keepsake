import { View } from "react-native";
import { mediaStatus, type MediaItem } from "../../api";
import { Image, Ionicons } from "../../styled";

export type VideoStillProps = { item: Pick<MediaItem, "id" | "type" | "status" | "url" | "posterUrl"> };

/**
 * A video's place in a thumbnail: its Mux poster frame, an ordinary image, so
 * no player is ever spun up per thumbnail. While Mux is still preparing the
 * clip (or there's no poster for any other reason) it's a quiet deep-teal
 * tile instead.
 */
export function VideoStill({ item }: VideoStillProps) {
  const poster = mediaStatus(item) === "READY" ? item.posterUrl : null;
  return (
    <View className="absolute inset-0 items-center justify-center bg-ink">
      <Ionicons name="videocam-outline" size={22} colorClassName="accent-white/55" />
      {poster ? (
        <Image
          source={{ uri: poster }}
          className="absolute inset-0"
          contentFit="cover"
          transition={200}
          recyclingKey={item.id}
        />
      ) : null}
    </View>
  );
}
