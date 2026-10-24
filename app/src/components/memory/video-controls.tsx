import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { clock } from "../../format";
import { Ionicons } from "../../styled";
import { useColor } from "../../theme";
import { ScrubTrack } from "../audio";

export type HeroVideoProps = {
  uri: string;
  /** The clip's Mux poster, shown until it first plays. */
  posterUrl?: string | null;
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
  const black = useColor("black");

  return (
    <View
      // Clear of the content card's rounded top, which overlaps the hero.
      className="absolute right-0 bottom-0 left-0 flex-row items-center gap-3 px-4 pt-9 pb-10"
      style={{ pointerEvents: "box-none" }}
    >
      {/* A soft dark fade so white controls read over a bright frame. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
        <Defs>
          <LinearGradient id="hero-video-scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={black} stopOpacity={0} />
            <Stop offset="1" stopColor={black} stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero-video-scrim)" />
      </Svg>
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause video" : "Play video"}
        className="h-[30px] w-[30px] items-center justify-center"
      >
        <Ionicons name={playing ? "pause" : "play"} size={24} colorClassName="accent-white" />
      </Pressable>
      <ScrubTrack
        value={shown}
        max={total}
        onScrub={setScrubbing}
        onCommit={commit}
        label="Video position"
        // ScrubTrack takes a style, not a className.
        style={{ flex: 1, height: 28, justifyContent: "center" }}
      >
        <View className="pointer-events-none h-[3px] overflow-hidden rounded-[2px] bg-white/45">
          <View className="h-[3px] bg-white" style={{ width: `${fraction * 100}%` }} />
        </View>
        {total > 0 ? (
          <View
            className="pointer-events-none absolute ml-[-6.5px] h-[13px] w-[13px] rounded-full bg-white"
            style={{ left: `${fraction * 100}%` }}
          />
        ) : null}
      </ScrubTrack>
      <Text className="font-sans-semibold text-[13px] text-white tabular-nums">
        {clock(shown)}
        {total > 0 ? ` / ${clock(total)}` : ""}
      </Text>
      <Pressable
        onPress={onFullscreen}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Full screen"
        className="h-[30px] w-[30px] items-center justify-center"
      >
        <Ionicons name="scan-outline" size={22} colorClassName="accent-white" />
      </Pressable>
    </View>
  );
}
