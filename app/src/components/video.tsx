import { useEventListener } from "expo";
import { useVideoPlayer } from "expo-video";
import { useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { videoSource } from "../playback";
import { VideoView } from "../styled";

export type VideoMeta = { durationS?: number; width?: number; height?: number };

export type VideoClipProps = {
  uri: string;
  // Only the web's <video> draws it; a phone's player paints the stream's first frame.
  posterUrl?: string | null;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  contentFit?: "contain" | "cover";
  onLoad?: (meta: VideoMeta) => void;
  onError?: () => void;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

export function VideoClip({
  uri,
  controls = true,
  autoPlay = false,
  muted = false,
  contentFit = "contain",
  onLoad,
  onError,
  className,
  style,
}: VideoClipProps) {
  // Pinned: a signed playback URL changes on every refetch, and a new source
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
      className={className}
      style={style}
    />
  );
}
