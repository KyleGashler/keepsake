import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useClipPlayback } from "../audio";
import { clock } from "../format";
import { colors, radius, spacing, type } from "../theme";

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
    <View style={styles.card}>
      <Pressable
        onPress={toggle}
        disabled={failed}
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${title}` : `Play ${title}`}
        hitSlop={6}
        style={({ pressed }) => [styles.play, failed && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={17}
          color={colors.surface}
          // The play triangle reads as off-centre without a nudge.
          style={playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {failed ? (
          <Text style={type.caption}>This recording can't play here.</Text>
        ) : (
          <>
            <Scrubber value={position} max={total} onScrub={scrub} onCommit={seek} />
            <View style={styles.times}>
              <Text style={styles.time}>{clock(position)}</Text>
              <Text style={styles.time}>{total > 0 ? clock(total) : ""}</Text>
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
 * (`pointerEvents="none"`). Plain responders, so it works the same under
 * react-native-web and needs no slider dependency.
 */
export function ScrubTrack({
  value,
  max,
  onScrub,
  onCommit,
  label = "Playback position",
  onWidth,
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
    <ScrubTrack value={value} max={max} onScrub={onScrub} onCommit={onCommit} style={styles.hitbox}>
      <View pointerEvents="none" style={styles.rail}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      {max > 0 ? <View pointerEvents="none" style={[styles.thumb, { left: `${fraction * 100}%` }]} /> : null}
    </ScrubTrack>
  );
}

const THUMB = 12;

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  play: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14.5, color: colors.ink },
  hitbox: { height: 22, justifyContent: "center", marginTop: 2 },
  rail: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  fill: { height: 4, backgroundColor: colors.accent },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accentDeep,
  },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { fontSize: 11.5, color: colors.muted, fontVariant: ["tabular-nums"] },
});
