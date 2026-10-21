import { createElement } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../../theme";
import type { VideoStillProps } from "./video-still";

export type { VideoStillProps };

/** The first frame of a video, for a thumbnail: a muted `<video>` that never plays. */
export function VideoStill({ uri }: VideoStillProps) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ink, pointerEvents: "none" }]}>
      {createElement("video", {
        // Safari won't paint a frame for preload="metadata" without a nudge past zero.
        src: uri.includes("#") ? uri : `${uri}#t=0.001`,
        muted: true,
        playsInline: true,
        preload: "metadata",
        tabIndex: -1,
        "aria-hidden": true,
        style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
      })}
    </View>
  );
}
