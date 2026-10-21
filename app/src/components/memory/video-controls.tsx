import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { clock } from "../../format";
import { fonts, spacing } from "../../theme";
import { ScrubTrack } from "../audio";

export type HeroVideoProps = {
  uri: string;
  /** What the server knows, until the player reports its own. */
  durationS?: number | null;
  /** Stop playing (the viewer opened, the page lost focus). Doesn't auto-resume. */
  paused?: boolean;
  /** The clip can't be played here; the caller offers the original instead. */
  onError?: () => void;
};

/**
 * The hero video's own controls, drawn over the bottom of the picture: play /
 * pause, a white scrubber, "0:12 / 0:28", and full screen. Shared by the
 * expo-video player (hero-video.tsx) and the web's `<video>` (hero-video.web.tsx).
 */
export function VideoControls({
  playing,
  position,
  total,
  onToggle,
  onSeek,
  onFullscreen,
}: {
  playing: boolean;
  position: number;
  total: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onFullscreen: () => void;
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const shown = scrubbing ?? position;
  const commit = (seconds: number) => {
    setScrubbing(null);
    onSeek(seconds);
  };
  const fraction = total > 0 ? Math.min(1, Math.max(0, shown / total)) : 0;

  return (
    <View style={styles.bar} pointerEvents="box-none">
      {/* A soft dark fade so white controls read over a bright frame. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="hero-video-scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero-video-scrim)" />
      </Svg>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause video" : "Play video"}
        style={styles.iconButton}
      >
        <Ionicons name={playing ? "pause" : "play"} size={24} color="#fff" />
      </Pressable>
      <ScrubTrack
        value={shown}
        max={total}
        onScrub={setScrubbing}
        onCommit={commit}
        label="Video position"
        style={styles.track}
      >
        <View pointerEvents="none" style={styles.rail}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        {total > 0 ? (
          <View pointerEvents="none" style={[styles.thumb, { left: `${fraction * 100}%` }]} />
        ) : null}
      </ScrubTrack>
      <Text style={styles.time}>
        {clock(shown)}
        {total > 0 ? ` / ${clock(total)}` : ""}
      </Text>
      <Pressable
        onPress={onFullscreen}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Full screen"
        style={styles.iconButton}
      >
        <Ionicons name="scan-outline" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

const THUMB = 13;

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // Clear of the content card's rounded top, which overlaps the hero.
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl + spacing.lg,
  },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  track: { flex: 1, height: 28, justifyContent: "center" },
  rail: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.45)", overflow: "hidden" },
  fill: { height: 3, backgroundColor: "#fff" },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: "#fff",
  },
  time: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: "#fff", fontVariant: ["tabular-nums"] },
});
