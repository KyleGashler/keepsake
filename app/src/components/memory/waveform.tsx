import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useClipPlayback } from "../../audio";
import { clock } from "../../format";
import { brand, colors, fonts, spacing, type } from "../../theme";
import { ScrubTrack } from "../audio";
import { pseudoWaveform } from "./helpers";

const BAR = 2.5;
const GAP = 2;
const HEIGHT = 34;
/** The part of the clip still to come. */
const UNPLAYED = brand.duskBlue;

/**
 * A recording as the memory page shows it: a round deep-teal play button, a
 * waveform you can tap or drag to scrub, and the time. There's no waveform
 * data yet, so the bars are a stand-in drawn from the clip's id — the same
 * clip always draws the same shape.
 */
export function WaveformPlayer({
  id,
  uri,
  durationS,
  label,
}: {
  /** Seeds the waveform's shape. */
  id: string;
  uri: string;
  durationS?: number | null;
  /** What a screen reader calls it — "Voice recording". */
  label: string;
}) {
  const { playing, position, total, failed, toggle, seek, scrub } = useClipPlayback(uri, durationS);
  const [width, setWidth] = useState(0);
  const count = Math.max(0, Math.floor((width + GAP) / (BAR + GAP)));
  const bars = useMemo(() => pseudoWaveform(id, count), [id, count]);
  const played = total > 0 ? Math.min(1, position / total) : 0;
  const started = position > 0.05;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        disabled={failed}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
        style={({ pressed }) => [styles.play, failed && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={20}
          color={colors.onPrimary}
          // The play triangle reads as off-centre without a nudge.
          style={playing ? undefined : { marginLeft: 3 }}
        />
      </Pressable>
      {failed ? (
        <Text style={[type.caption, { flex: 1 }]}>This recording can't play here.</Text>
      ) : (
        <ScrubTrack
          value={position}
          max={total}
          onScrub={scrub}
          onCommit={seek}
          label={label}
          onWidth={setWidth}
          style={styles.wave}
        >
          {bars.map((bar, i) => (
            <View
              key={bar.key}
              pointerEvents="none"
              style={[
                styles.bar,
                {
                  height: Math.max(3, bar.height * HEIGHT),
                  backgroundColor: (i + 0.5) / bars.length <= played ? colors.primary : UNPLAYED,
                },
              ]}
            />
          ))}
        </ScrubTrack>
      )}
      <Text style={styles.time}>
        {started ? `${clock(position)} / ` : ""}
        {total > 0 ? clock(total) : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  wave: {
    flex: 1,
    height: HEIGHT + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: GAP,
    overflow: "hidden",
  },
  bar: { width: BAR, borderRadius: BAR / 2 },
  time: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13.5,
    color: colors.inkSoft,
    fontVariant: ["tabular-nums"],
  },
});
