import { createElement, useState } from "react";
import { View } from "react-native";
import type { VideoClipProps, VideoMeta } from "./video";

export type { VideoClipProps, VideoMeta };

/**
 * The web player: a plain `<video>`. The browser's own controls are the best
 * ones on offer, and it plays a MediaRecorder blob or a presigned original
 * without any setup.
 *
 * A clip the browser can't decode (an iPhone's HEVC `.mov` in Chrome, say)
 * either errors or loads metadata with no picture; both count as `onError`.
 * Chrome's MediaRecorder WebM has no duration in its header, so `durationS`
 * is left out rather than reported as Infinity.
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
  const [source] = useState(uri);
  // A still tile needs a frame to show; Safari won't paint one for
  // preload="metadata" unless asked to seek a hair past zero.
  const src = !controls && !autoPlay && !source.includes("#") ? `${source}#t=0.001` : source;

  return (
    <View style={[{ overflow: "hidden" }, style]}>
      {createElement("video", {
        src,
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
