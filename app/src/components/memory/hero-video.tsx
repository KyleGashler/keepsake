import { useEventListener } from "expo";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { videoSource } from "../../playback";
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
 * The stream is Mux's HLS, already transcoded for every device. Its poster
 * covers the picture until the first play, so there's no black box while the
 * player warms up. A clip that still can't play fires `onError`.
 */
export function HeroVideo({ uri, posterUrl, durationS, paused = false, onError }: HeroVideoProps) {
  // Pinned: a signed URL changes on every refetch, and a new source would
  // rebuild the player mid-watch.
  const [source] = useState(() => videoSource(uri));
  const [poster] = useState(posterUrl);
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(durationS ?? 0);

  useEventListener(player, "playingChange", ({ isPlaying }) => {
    setPlaying(isPlaying);
    if (isPlaying) setStarted(true);
  });
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
      {poster && !started ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
        />
      ) : null}
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
