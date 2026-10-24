import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useClipPlayback } from "../../audio";
import { clock } from "../../format";
import { Ionicons } from "../../styled";
import { ScrubTrack } from "../audio";
import { pseudoWaveform } from "./helpers";

const BAR = 2.5;
const GAP = 2;
const HEIGHT = 34;

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
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={toggle}
        disabled={failed}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
        className={`h-11 w-11 items-center justify-center rounded-full bg-primary active:opacity-80 ${failed ? "opacity-40" : ""}`}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={20}
          colorClassName="accent-on-primary"
          // The play triangle reads as off-centre without a nudge.
          className={playing ? undefined : "ml-[3px]"}
        />
      </Pressable>
      {failed ? (
        <Text className="flex-1 type-caption">This recording can't play here.</Text>
      ) : (
        <ScrubTrack
          value={position}
          max={total}
          onScrub={scrub}
          onCommit={seek}
          label={label}
          onWidth={setWidth}
          // ScrubTrack takes a style, not a className; HEIGHT and GAP also size the bars.
          style={{
            flex: 1,
            height: HEIGHT + 8,
            flexDirection: "row",
            alignItems: "center",
            gap: GAP,
            overflow: "hidden",
          }}
        >
          {bars.map((bar, i) => (
            <View
              key={bar.key}
              // Dusk blue is the part of the clip still to come.
              className={`pointer-events-none w-[2.5px] rounded-[1.25px] ${
                (i + 0.5) / bars.length <= played ? "bg-primary" : "bg-dusk-blue"
              }`}
              style={{ height: Math.max(3, bar.height * HEIGHT) }}
            />
          ))}
        </ScrubTrack>
      )}
      <Text className="font-sans-semibold text-[13.5px] text-ink-soft tabular-nums">
        {started ? `${clock(position)} / ` : ""}
        {total > 0 ? clock(total) : ""}
      </Text>
    </View>
  );
}
