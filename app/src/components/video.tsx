import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { videoSource } from "../playback";

/** What the player learned about a clip once it opened it. */
export type VideoMeta = { durationS?: number; width?: number; height?: number };

export type VideoClipProps = {
  uri: string;
  /**
   * A still to show before playback (a Mux poster). The web's `<video>` uses
   * it; a phone's player paints the stream's own first frame.
   */
  posterUrl?: string | null;
  /** Player controls (and fullscreen). Off for a still preview tile. */
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  contentFit?: "contain" | "cover";
  onLoad?: (meta: VideoMeta) => void;
  /** The clip can't be played here — a codec this device lacks, or a bad URL. */
  onError?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * One video, played in place with expo-video. The web build swaps in
 * `video.web.tsx`, a plain `<video>` element.
 *
 * Plays a local file (the recorder's review) or a Mux HLS stream, which Mux
 * has already transcoded to something every device decodes. A player error
 * or a video track the device reports as unsupported fires `onError`.
 */
export function VideoClip({
  uri,
  controls = true,
  autoPlay = false,
  muted = false,
  contentFit = "contain",
  onLoad,
  onError,
  style,
}: VideoClipProps) {
  // Pin the source for the life of the view. A signed playback URL changes on
  // every refetch (the memory page polls while transcribing), and a new source
  // would rebuild the player mid-watch.
  const [source] = useState(() => videoSource(uri));
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.muted = muted;
    if (autoPlay) p.play();
  });

  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "error") onError?.();
  });

  useEventListener(player, "sourceLoad", ({ duration, availableVideoTracks }) => {
    const tracks = availableVideoTracks ?? [];
    // Android says outright when it has no decoder for the track.
    if (tracks.length && tracks.every((t) => !t.isSupported)) {
      onError?.();
      return;
    }
    const size = tracks[0]?.size;
    onLoad?.({
      durationS: duration > 0 && Number.isFinite(duration) ? duration : undefined,
      width: size?.width || undefined,
      height: size?.height || undefined,
    });
  });

  return (
    <VideoView
      player={player}
      nativeControls={controls}
      contentFit={contentFit}
      fullscreenOptions={{ enable: controls }}
      allowsPictureInPicture={false}
      style={style}
    />
  );
}
