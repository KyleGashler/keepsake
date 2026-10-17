import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { clock } from "../format";
import { colors, radius, spacing, type } from "../theme";

/**
 * One recording, playable in place: play/pause, a seekable track, and time.
 * Used on the memory page, in compose, and on the recorder's review step, so a
 * clip looks and behaves the same everywhere it appears.
 */
export function AudioClip({
  uri,
  title,
  durationS,
}: {
  uri: string;
  title: string;
  /**
   * What the server (or recorder) knows. Chrome's MediaRecorder writes WebM
   * with no duration in the header, so the player can report 0 — fall back to
   * this rather than show a track with no end.
   */
  durationS?: number | null;
}) {
  // Pin the source for the life of the card. A presigned read URL changes on
  // every refetch (the memory page polls while transcribing), and a new source
  // would rebuild the player mid-listen.
  const [source] = useState(uri);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const total = status.duration > 0 ? status.duration : (durationS ?? 0);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);

  // While paused, a status event isn't guaranteed after a seek, so read the
  // player's live position instead of the last one it reported.
  const reported = status.playing ? status.currentTime : player.currentTime;
  const current = scrubbing ?? seekTarget ?? reported;
  const position = total > 0 ? Math.min(current, total) : current;
  const failed = Boolean(status.error);
  const atEnd = status.didJustFinish || (total > 0 && status.currentTime >= total - 0.25);

  async function toggle() {
    if (status.playing) return player.pause();
    if (atEnd) await player.seekTo(0);
    player.play();
  }

  async function seek(seconds: number) {
    setScrubbing(null);
    setSeekTarget(seconds);
    try {
      await player.seekTo(seconds);
    } finally {
      // Hold the thumb where it was dropped until the player has caught up.
      setTimeout(() => setSeekTarget(null), 400);
    }
  }

  return (
    <View style={styles.card}>
      <Pressable
        onPress={toggle}
        disabled={failed}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? `Pause ${title}` : `Play ${title}`}
        hitSlop={6}
        style={({ pressed }) => [styles.play, failed && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}
      >
        <Ionicons
          name={status.playing ? "pause" : "play"}
          size={17}
          color={colors.surface}
          // The play triangle reads as off-centre without a nudge.
          style={status.playing ? undefined : { marginLeft: 2 }}
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
            <Scrubber value={position} max={total} onScrub={setScrubbing} onCommit={seek} />
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
 * A plain responder-driven track: tap anywhere to jump, drag to scrub, seek on
 * release. Works the same under react-native-web, so no slider dependency.
 */
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
  const width = useRef(0);
  const originX = useRef(0);
  const last = useRef(0);
  const enabled = max > 0;
  const fraction = enabled ? Math.min(1, Math.max(0, value / max)) : 0;

  function at(e: GestureResponderEvent) {
    const x = e.nativeEvent.pageX - originX.current;
    last.current = width.current > 0 ? Math.min(1, Math.max(0, x / width.current)) * max : 0;
    return last.current;
  }

  return (
    <View
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
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
      accessibilityLabel="Playback position"
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value), text: clock(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === "increment" ? 5 : -5;
        onCommit(Math.min(max, Math.max(0, value + step)));
      }}
      style={styles.hitbox}
    >
      <View pointerEvents="none" style={styles.rail}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      {enabled ? <View pointerEvents="none" style={[styles.thumb, { left: `${fraction * 100}%` }]} /> : null}
    </View>
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
