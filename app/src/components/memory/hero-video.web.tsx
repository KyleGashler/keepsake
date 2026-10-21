import { createElement, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { VideoControls, type HeroVideoProps } from "./video-controls";

export type { HeroVideoProps };

/** Safari on iPhone can't put an arbitrary element full screen, only a video. */
type IOSVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * The hero's video on the web: a plain `<video>` without the browser's
 * controls, under the page's own. Full screen turns the browser's controls
 * back on, since ours stay behind on the page.
 */
export function HeroVideo({ uri, durationS, paused = false, onError }: HeroVideoProps) {
  const [source] = useState(uri);
  const video = useRef<IOSVideo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(durationS ?? 0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === video.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (paused) video.current?.pause();
  }, [paused]);

  function toggle() {
    const el = video.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    if (el.ended) el.currentTime = 0;
    void el.play().catch(() => undefined);
  }

  function seek(seconds: number) {
    const el = video.current;
    if (!el) return;
    el.currentTime = seconds;
    setPosition(seconds);
  }

  function enterFullscreen() {
    const el = video.current;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else el.webkitEnterFullscreen?.();
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      {createElement("video", {
        ref: video,
        // Ask for a frame a hair past zero so Safari paints a still before play.
        src: source.includes("#") ? source : `${source}#t=0.001`,
        controls: fullscreen,
        playsInline: true,
        preload: "metadata",
        onPlay: () => setPlaying(true),
        onPause: () => setPlaying(false),
        onTimeUpdate: (e: { currentTarget: HTMLVideoElement }) => setPosition(e.currentTarget.currentTime),
        onError: () => onError?.(),
        onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => {
          const el = e.currentTarget;
          // Metadata with no picture: a codec this browser can't decode.
          if (el.videoWidth === 0) onError?.();
          if (Number.isFinite(el.duration) && el.duration > 0) setTotal(el.duration);
        },
        style: {
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: fullscreen ? "contain" : "cover",
          backgroundColor: "#000",
          display: "block",
        },
      })}
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
        onFullscreen={enterFullscreen}
      />
    </View>
  );
}
