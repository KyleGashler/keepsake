import { useRef, type ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useClipPlayback } from "../audio";
import { clock } from "../format";
import { Ionicons } from "../styled";

/**
 * One recording, playable in place: play/pause, a seekable track, and time.
 * Used in compose and on the recorder's review step, so a clip looks and
 * behaves the same everywhere it appears. The memory page draws the same
 * playback as a waveform (components/memory/waveform.tsx).
 */
export function AudioClip({
  uri,
  title,
  durationS,
}: {
  uri: string;
  title: string;
  /** What the server (or recorder) knows; see `useClipPlayback`. */
  durationS?: number | null;
}) {
  const { playing, position, total, failed, toggle, seek, scrub } = useClipPlayback(uri, durationS);

  return (
    <View className="flex-row items-center gap-3 rounded-md border border-line bg-surface p-3">
      <Pressable
        onPress={toggle}
        disabled={failed}
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${title}` : `Play ${title}`}
        hitSlop={6}
        className={`h-10 w-10 items-center justify-center rounded-full bg-accent-deep active:opacity-75 ${
          failed ? "opacity-40" : ""
        }`}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={17}
          colorClassName="accent-surface"
          // The play triangle reads as off-centre without a nudge.
          className={playing ? undefined : "ml-0.5"}
        />
      </Pressable>
      <View className="flex-1">
        <Text className="text-[14.5px] text-ink" numberOfLines={1}>
          {title}
        </Text>
        {failed ? (
          <Text className="type-caption">This recording can't play here.</Text>
        ) : (
          <>
            <Scrubber value={position} max={total} onScrub={scrub} onCommit={seek} />
            <View className="flex-row justify-between">
              <Text className="text-[11.5px] text-muted tabular-nums">{clock(position)}</Text>
              <Text className="text-[11.5px] text-muted tabular-nums">{total > 0 ? clock(total) : ""}</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * A seekable area: tap anywhere to jump, drag to scrub, seek on release, and
 * ±5 s from assistive tech. What it looks like is the children's business —
 * a rail and thumb, a waveform — and they must ignore touches
 * (`pointerEvents: "none"` in their style). Plain responders, so it works the same under
 * react-native-web and needs no slider dependency.
 */
export function ScrubTrack({
  value,
  max,
  onScrub,
  onCommit,
  label = "Playback position",
  onWidth,
  className,
  style,
  children,
}: {
  value: number;
  max: number;
  onScrub: (seconds: number) => void;
  onCommit: (seconds: number) => void;
  label?: string;
  /** The track's laid-out width, for children that draw to it. */
  onWidth?: (width: number) => void;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const width = useRef(0);
  const originX = useRef(0);
  const last = useRef(0);
  const enabled = max > 0;

  function at(e: GestureResponderEvent) {
    const x = e.nativeEvent.pageX - originX.current;
    last.current = width.current > 0 ? Math.min(1, Math.max(0, x / width.current)) * max : 0;
    return last.current;
  }

  function onLayout(e: LayoutChangeEvent) {
    width.current = e.nativeEvent.layout.width;
    onWidth?.(width.current);
  }

  return (
    <View
      onLayout={onLayout}
      onStartShouldSetResponder={() => enabled}
      onMoveShouldSetResponder={() => enabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        // Children ignore touches, so locationX is measured from the track.
        originX.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        onScrub(at(e));
      }}
      onResponderMove={(e) => onScrub(at(e))}
      onResponderRelease={(e) => onCommit(at(e))}
      onResponderTerminate={() => onCommit(last.current)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value), text: clock(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === "increment" ? 5 : -5;
        onCommit(Math.min(max, Math.max(0, value + step)));
      }}
      className={className}
      style={style}
    >
      {children}
    </View>
  );
}

/** A rail-and-thumb track. */
function Scrubber({
  value,
  max,
  onScrub,
  onCommit,
}: {
  value: number;
  max: number;
  onScrub: (seconds: number) => void;
  onCommit: (seconds: number) => void;
}) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <ScrubTrack
      value={value}
      max={max}
      onScrub={onScrub}
      onCommit={onCommit}
      className="mt-0.5 h-[22px] justify-center"
    >
      <View className="pointer-events-none h-1 overflow-hidden rounded-[2px] bg-surface-alt">
        <View className="h-1 bg-accent" style={{ width: `${fraction * 100}%` }} />
      </View>
      {max > 0 ? (
        <View
          className="pointer-events-none absolute -ml-1.5 h-3 w-3 rounded-[6px] bg-accent-deep"
          style={{ left: `${fraction * 100}%` }}
        />
      ) : null}
    </ScrubTrack>
  );
}
