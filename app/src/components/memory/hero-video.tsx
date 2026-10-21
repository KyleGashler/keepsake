import { useEventListener } from "expo";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { VideoControls, type HeroVideoProps } from "./video-controls";

export type { HeroVideoProps };

/** Setting `currentTime` is how expo-video seeks (exactly, by default). */
function seekPlayer(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

/**
 * The hero's video on a phone: expo-video with the native controls off and
 * the page's own drawn over it. Full screen hands over to the system player,
 * which brings its own controls.
 *
 * Nothing is transcoded yet (docs/PLAN.md, "Decision: video, for now"); a
 * clip this device can't decode fires `onError` and the caller offers the
 * original instead.
 */
export function HeroVideo({ uri, durationS, paused = false, onError }: HeroVideoProps) {
  // Pinned: a presigned URL changes on every refetch, and a new source would
  // rebuild the player mid-watch.
  const [source] = useState(uri);
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(durationS ?? 0);

  useEventListener(player, "playingChange", ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, "timeUpdate", ({ currentTime }) => setPosition(currentTime));
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onError?.();
  });
  useEventListener(player, "sourceLoad", ({ duration, availableVideoTracks }) => {
    const tracks = availableVideoTracks ?? [];
    // Android says outright when it has no decoder for the track.
    if (tracks.length && tracks.every((t) => !t.isSupported)) onError?.();
    if (duration > 0 && Number.isFinite(duration)) setTotal(duration);
  });
  useEventListener(player, "playToEnd", () => setPosition(total));

  useEffect(() => {
    if (paused) player.pause();
  }, [paused, player]);

  function toggle() {
    if (player.playing) return player.pause();
    if (total > 0 && player.currentTime >= total - 0.25) seekPlayer(player, 0);
    player.play();
  }

  function seek(seconds: number) {
    seekPlayer(player, seconds);
    setPosition(seconds);
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        ref={view}
        player={player}
        nativeControls={false}
        contentFit="cover"
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
        style={StyleSheet.absoluteFill}
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Pause video" : "Play video"}
      />
      <VideoControls
        playing={playing}
        position={position}
        total={total}
        onToggle={toggle}
        onSeek={seek}
        onFullscreen={() => void view.current?.enterFullscreen()}
      />
    </View>
  );
}
