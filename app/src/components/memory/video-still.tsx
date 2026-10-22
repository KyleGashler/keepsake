import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { mediaStatus, type MediaItem } from "../../api";
import { colors } from "../../theme";

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
    <View style={[StyleSheet.absoluteFill, styles.tile]}>
      <Ionicons name="videocam-outline" size={22} color="rgba(255,255,255,0.55)" />
      {poster ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          recyclingKey={item.id}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
});
