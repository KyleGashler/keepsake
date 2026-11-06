import { View } from "react-native";
import { mediaStatus, type MediaItem } from "../../api";
import { Image, Ionicons } from "../../styled";

export type VideoStillProps = { item: Pick<MediaItem, "id" | "type" | "status" | "url" | "posterUrl"> };

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
