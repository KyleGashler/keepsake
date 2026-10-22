import { createElement, useRef, useState } from "react";
import { View } from "react-native";
import type { VideoClipProps, VideoMeta } from "./video";
import { isHlsUrl } from "../playback";
import { useHlsSource } from "./web-hls";

export type { VideoClipProps, VideoMeta };

/**
 * The web player: a plain `<video>`. The browser's own controls are the best
 * ones on offer. It plays a MediaRecorder blob (the recorder's review) as is,
 * and a Mux HLS stream natively in Safari or through hls.js elsewhere
 * (`web-hls.ts`).
 *
 * A clip the browser can't decode either errors or loads metadata with no
 * picture; both count as `onError`. Chrome's MediaRecorder WebM has no
 * duration in its header, so `durationS` is left out rather than reported as
 * Infinity.
 */
export function VideoClip({
  uri,
  posterUrl,
  controls = true,
  autoPlay = false,
  muted = false,
  contentFit = "contain",
  onLoad,
  onError,
  style,
}: VideoClipProps) {
  const [source] = useState(uri);
  const video = useRef<HTMLVideoElement | null>(null);
  const played = useHlsSource(video, source, onError);
  // A still tile needs a frame to show; Safari won't paint one for
  // preload="metadata" unless asked to seek a hair past zero. A stream has a
  // poster for that instead.
  const src =
    played && !controls && !autoPlay && !isHlsUrl(played) && !played.includes("#")
      ? `${played}#t=0.001`
      : played;

  return (
    <View style={[{ overflow: "hidden" }, style]}>
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
          if (el.videoWidth === 0) {
            onError?.();
            return;
          }
          const meta: VideoMeta = {
            durationS: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined,
            width: el.videoWidth,
            height: el.videoHeight,
          };
          onLoad?.(meta);
        },
        style: {
          width: "100%",
          height: "100%",
          objectFit: contentFit,
          backgroundColor: controls ? "#000" : "transparent",
          display: "block",
        },
      })}
    </View>
  );
}
