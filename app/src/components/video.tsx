import { useEventListener } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/** What the player learned about a clip once it opened it. */
export type VideoMeta = { durationS?: number; width?: number; height?: number };

export type VideoClipProps = {
  uri: string;
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
 * Nothing is transcoded (docs/PLAN.md, "Decision: video, for now"), so an
 * iPhone's HEVC original may not decode on every Android device. That shows
 * up as a player error or a video track the device reports as unsupported;
 * either way `onError` fires and the caller offers the original instead.
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
  // Pin the source for the life of the view. A presigned read URL changes on
  // every refetch (the memory page polls while transcribing), and a new source
  // would rebuild the player mid-watch.
  const [source] = useState(uri);
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
    if (tracks.length && tracks.every((t) => t.isSupported === false)) {
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
