import { createElement, useRef, useState } from "react";
import { View } from "react-native";
import type { VideoClipProps, VideoMeta } from "./video";
import { isHlsUrl } from "../playback";
import { useHlsSource } from "./web-hls";

export type { VideoClipProps, VideoMeta };

export function VideoClip({
  uri,
  posterUrl,
  controls = true,
  autoPlay = false,
  muted = false,
  contentFit = "contain",
  onLoad,
  onError,
  className,
  style,
}: VideoClipProps) {
  const [source] = useState(uri);
  const video = useRef<HTMLVideoElement | null>(null);
  const played = useHlsSource(video, source, onError);
  // Safari won't paint a frame for preload="metadata" unless asked to seek a
  // hair past zero. A stream has a poster for that instead.
  const src =
    played && !controls && !autoPlay && !isHlsUrl(played) && !played.includes("#")
      ? `${played}#t=0.001`
      : played;

  return (
    <View className={`overflow-hidden ${className ?? ""}`} style={style}>
      {createElement("video", {
        ref: video,
        src,
        poster: posterUrl ?? undefined,
        controls,
        autoPlay,
        muted,
        playsInline: true,
        preload: "metadata",
        onError: () => onError?.(),
        onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => {
          const el = e.currentTarget;
          // A clip the browser can't decode may load metadata with no picture.
          if (el.videoWidth === 0) {
            onError?.();
            return;
          }
          // Chrome's MediaRecorder WebM has no duration in its header: Infinity.
          const meta: VideoMeta = {
            durationS: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined,
            width: el.videoWidth,
            height: el.videoHeight,
          };
          onLoad?.(meta);
        },
        className: `block h-full w-full ${contentFit === "cover" ? "object-cover" : "object-contain"} ${
          controls ? "bg-black" : "bg-transparent"
        }`,
      })}
    </View>
  );
}
