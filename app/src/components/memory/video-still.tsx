import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { colors } from "../../theme";

export type VideoStillProps = { uri: string };

/**
 * A video's place in a thumbnail. There are no poster frames yet (A6), and
 * <Image> can't decode a video, so a phone shows a quiet deep-teal tile
 * rather than spinning up a player per thumbnail. The web paints the first
 * frame (video-still.web.tsx).
 */
export function VideoStill(_props: VideoStillProps) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.tile]}>
      <Ionicons name="videocam-outline" size={22} color="rgba(255,255,255,0.55)" />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
});
