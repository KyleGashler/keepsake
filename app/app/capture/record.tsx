import { Ionicons } from "@expo/vector-icons";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
} from "expo-audio";
import { File as FsFile } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { levelFromMetering, normalizeAudioType, VOICE_RECORDING } from "../../src/audio";
import { AudioClip } from "../../src/components/audio";
import { StardustCluster } from "../../src/components/brand";
import { AppHeader, Button } from "../../src/components/ui";
import { draft } from "../../src/draft";
import { clock, errorMessage } from "../../src/format";
import { colors, layout, MAX_WIDTH, radius, spacing, type } from "../../src/theme";

type Phase = "asking" | "denied" | "ready" | "starting" | "recording" | "paused" | "stopping" | "review";

/** How many bars the meter keeps — the most recent ~3 seconds at the poll rate. */
const BARS = 36;
const POLL_MS = 90;

/**
 * The recorder: one big button, the time, and a level that moves when someone
 * speaks, so it's obvious it's listening. Nothing is uploaded here — "Use
 * recording" hands the clip to compose like any other captured media.
 */
export default function RecordScreen() {
  const params = useLocalSearchParams<{ prompt?: string; collectionId?: string }>();
  const insets = useSafeAreaInsets();

  // Declared before the recorder hook on purpose: React runs unmount cleanups
  // in declaration order, so this stops a live recording before the hook
  // releases the native recorder (and, on the web, turns the mic light off —
  // the web recorder is never released on its own).
  const recorderRef = useRef<AudioRecorder | null>(null);
  const liveRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (liveRef.current && recorder) {
        liveRef.current = false;
        void stopQuietly(recorder);
      }
      void resetAudioMode();
    },
    [],
  );

  const recorder = useAudioRecorder(VOICE_RECORDING);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

  const [phase, setPhase] = useState<Phase>("asking");
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [clip, setClip] = useState<{ uri: string; durationS: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);
  // The recorder's own clock resets to zero on stop, so keep the last reading.
  const [recordedMs, setRecordedMs] = useState(0);

  async function askForMicrophone() {
    setPhase("asking");
    const granted = await microphoneGranted();
    if (mountedRef.current) setPhase(granted ? "ready" : "denied");
  }

  useEffect(() => {
    let cancelled = false;
    const ask = async () => {
      const granted = await microphoneGranted();
      if (!cancelled) setPhase(granted ? "ready" : "denied");
    };
    void ask();
    return () => {
      cancelled = true;
    };
  }, []);

  // Feed the meter and the clock while recording. Pausing flattens the meter
  // rather than leaving a frozen spike.
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const status = recorder.getStatus();
      setLevels((prev) => [...prev.slice(1), levelFromMetering(status.metering)]);
      setRecordedMs((prev) => Math.max(prev, status.durationMillis));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, recorder]);

  const elapsedMs = phase === "review" && clip ? clip.durationS * 1000 : recordedMs;

  async function start() {
    setError(null);
    setPhase("starting");
    try {
      // iOS won't hand over the microphone unless the session allows it.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      if (!mountedRef.current) {
        // Left while the microphone was still opening: close it again.
        await stopQuietly(recorder);
        return;
      }
      liveRef.current = true;
      setRecordedMs(0);
      setLevels(Array(BARS).fill(0));
      setPhase("recording");
    } catch (err) {
      liveRef.current = false;
      await resetAudioMode();
      setError(`The microphone didn't start. ${errorMessage(err)}`.trim());
      setPhase("ready");
    }
  }

  function pause() {
    recorder.pause();
    setLevels(Array(BARS).fill(0));
    setPhase("paused");
  }

  function resume() {
    recorder.record();
    setPhase("recording");
  }

  async function stop() {
    setPhase("stopping");
    const lastMs = Math.max(recordedMs, recorder.getStatus().durationMillis);
    try {
      await recorder.stop();
      liveRef.current = false;
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording was saved.");
      setClip({ uri, durationS: Math.max(1, Math.round(lastMs / 1000)) });
      setPhase("review");
    } catch (err) {
      liveRef.current = false;
      setError(`The recording couldn't be saved. ${errorMessage(err)}`.trim());
      setPhase("ready");
    } finally {
      await resetAudioMode();
    }
  }

  async function discard() {
    const ok = await confirm("Discard this recording?", "It hasn't been saved anywhere yet.", "Discard");
    if (!ok) return;
    if (liveRef.current) {
      liveRef.current = false;
      await stopQuietly(recorder);
      await resetAudioMode();
    }
    setClip(null);
    setRecordedMs(0);
    setLevels(Array(BARS).fill(0));
    setPhase("ready");
  }

  async function keepRecording() {
    if (!clip) return;
    setHandingOff(true);
    setError(null);
    try {
      let rawMime: string | null = null;
      let bytes: number | undefined;
      if (Platform.OS === "web") {
        // The Blob says what the browser actually wrote — WebM/Opus in Chrome,
        // WebM or MP4 in Safari depending on version.
        const blob = await (await fetch(clip.uri)).blob();
        rawMime = blob.type;
        bytes = blob.size;
      } else {
        try {
          bytes = new FsFile(clip.uri).size;
        } catch {
          // Size is only for the early over-the-limit check; init still enforces it.
        }
      }
      const { mime, ext } = normalizeAudioType(rawMime, clip.uri);
      draft.set([{ uri: clip.uri, name: `recording-${Date.now()}${ext}`, mime, bytes, durationS: clip.durationS }]);
      router.replace({
        pathname: "/capture/compose",
        params: {
          mode: "audio",
          ...(params.prompt ? { prompt: params.prompt } : {}),
          ...(params.collectionId ? { collectionId: params.collectionId } : {}),
        },
      });
    } catch (err) {
      setError(errorMessage(err));
      setHandingOff(false);
    }
  }

  const live = phase === "recording" || phase === "paused";

  return (
    <>
      <AppHeader back subtitle="Capture" title="Record a conversation" globalActions={false} />
      <View style={[styles.page, { paddingBottom: insets.bottom + spacing.lg }]}>
        {phase === "asking" ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accentDeep} />
            <Text style={[type.caption, { marginTop: spacing.md }]}>Asking for the microphone…</Text>
          </View>
        ) : null}
        {phase === "denied" ? <Denied onRetry={askForMicrophone} /> : null}
        {phase === "asking" || phase === "denied" ? null : (
          <View style={styles.stage}>
            <View style={{ alignItems: "center", gap: spacing.sm }}>
              <StardustCluster size={40} opacity={live ? 1 : 0.6} />
              <Text style={[type.caption, { textAlign: "center" }]}>{caption(phase)}</Text>
            </View>

            <Text style={styles.timer} accessibilityLabel={`Elapsed ${clock(elapsedMs / 1000)}`}>
              {clock(elapsedMs / 1000)}
            </Text>

            {phase === "review" && clip ? (
              <View style={{ alignSelf: "stretch" }}>
                <AudioClip uri={clip.uri} title="New recording" durationS={clip.durationS} />
              </View>
            ) : (
              <Meter levels={levels} active={phase === "recording"} />
            )}

            {phase === "review" ? (
              <View style={styles.reviewActions}>
                <Button
                  label={handingOff ? "Opening…" : "Use recording"}
                  icon="checkmark"
                  onPress={keepRecording}
                  disabled={handingOff}
                  style={{ alignSelf: "stretch" }}
                />
                <Button label="Discard" variant="secondary" icon="trash-outline" onPress={discard} />
              </View>
            ) : (
              <View style={styles.controls}>
                <SideButton
                  icon="trash-outline"
                  label="Discard"
                  onPress={discard}
                  hidden={!live}
                />
                <RecordButton
                  recording={live}
                  busy={phase === "starting" || phase === "stopping"}
                  onPress={live ? stop : start}
                />
                <SideButton
                  icon={phase === "paused" ? "mic-outline" : "pause"}
                  label={phase === "paused" ? "Resume" : "Pause"}
                  onPress={phase === "paused" ? resume : pause}
                  hidden={!live}
                />
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        )}
      </View>
    </>
  );
}

/** The line under the cluster, for whichever phase the recorder is in. */
function caption(phase: Phase) {
  if (phase === "review") return "Have a listen, then keep it or start over.";
  if (phase === "paused") return "Paused. Pick up where you left off.";
  if (phase === "recording") return "Listening…";
  return "Put the phone between you and just talk.";
}

function microphoneGranted() {
  return requestRecordingPermissionsAsync()
    .then((perm) => perm.granted)
    .catch(() => false);
}

/** Stop a recorder that may already have stopped; there's nothing to recover. */
function stopQuietly(recorder: AudioRecorder) {
  return recorder.stop().catch(() => undefined);
}

/** Put iOS back on the speaker for playback; a no-op elsewhere. */
async function resetAudioMode() {
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch {
    // Nothing to undo if the session never changed.
  }
}

/** Alert has no web implementation, so the browser's own dialog stands in. */
function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Keep recording", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );
}

function Denied({ onRetry }: { onRetry: () => void }) {
  const web = Platform.OS === "web";
  // Browsers only expose the microphone on https or localhost.
  const insecure = web && typeof window !== "undefined" && !window.isSecureContext;
  return (
    <View style={styles.centre}>
      <View style={styles.deniedIcon}>
        <Ionicons name="mic-off-outline" size={26} color={colors.accentDeep} />
      </View>
      <Text style={[type.heading, { textAlign: "center", marginTop: spacing.lg }]}>
        We can't hear you yet
      </Text>
      <Text style={[type.body, { textAlign: "center", marginTop: spacing.sm, maxWidth: 420 }]}>
        {deniedAdvice(web, insecure)}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.xl }}>
        {web ? null : (
          <Button label="Open settings" icon="settings-outline" onPress={() => void Linking.openSettings()} />
        )}
        <Button label="Try again" variant={web ? "primary" : "secondary"} icon="refresh" onPress={onRetry} />
      </View>
    </View>
  );
}

function deniedAdvice(web: boolean, insecure: boolean) {
  if (insecure) {
    return "This page isn't on a secure connection, so the browser won't share the microphone. Open little by little over https (or on this computer at localhost) to record.";
  }
  if (web) {
    return "Your browser is blocking the microphone for this site. Click the icon beside the address bar, allow the microphone, then come back here.";
  }
  return "To record a conversation, little by little needs to use the microphone. You can turn it on in Settings.";
}

/** A rolling level: newest bar on the right, each one a ~90 ms sample. */
function Meter({ levels, active }: { levels: number[]; active: boolean }) {
  return (
    <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {levels.map((level, i) => (
        <View
          // oxlint-disable-next-line react/no-array-index-key -- bars are fixed slots the levels scroll through
          key={i}
          style={[
            styles.bar,
            {
              height: 4 + level * 72,
              backgroundColor: active ? colors.accent : colors.line,
              opacity: active ? 0.35 + 0.65 * (i / levels.length) : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

function RecordButton({ recording, busy, onPress }: { recording: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={recording ? "Stop recording" : "Start recording"}
      style={({ pressed }) => [styles.recordOuter, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.recordInner, recording && styles.recordInnerStop]}>
        {busy ? <ActivityIndicator color={colors.surface} /> : null}
      </View>
    </Pressable>
  );
}

function SideButton({
  icon,
  label,
  onPress,
  hidden,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  hidden: boolean;
}) {
  // Kept in the layout while hidden so the record button doesn't jump sideways.
  return (
    <View style={{ width: 76, alignItems: "center", opacity: hidden ? 0 : 1 }} pointerEvents={hidden ? "none" : "auto"}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityElementsHidden={hidden}
        style={({ pressed }) => [styles.side, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name={icon} size={20} color={colors.ink} />
      </Pressable>
      <Text style={[type.caption, { marginTop: 6 }]}>{label}</Text>
    </View>
  );
}

const RECORD = 88;

const styles = StyleSheet.create({
  page: {
    flex: 1,
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
    paddingHorizontal: layout.gutter,
    backgroundColor: colors.bg,
  },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: spacing.lg },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  timer: {
    fontFamily: type.display.fontFamily,
    fontSize: 54,
    lineHeight: 64,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  meter: {
    height: 84,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  bar: { width: 5, borderRadius: 3 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg },
  reviewActions: { alignSelf: "stretch", gap: spacing.md, alignItems: "center" },
  recordOuter: {
    width: RECORD,
    height: RECORD,
    borderRadius: RECORD / 2,
    borderWidth: 4,
    borderColor: colors.accentSoft,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  recordInner: {
    width: RECORD - 22,
    height: RECORD - 22,
    borderRadius: (RECORD - 22) / 2,
    backgroundColor: colors.terracotta,
    alignItems: "center",
    justifyContent: "center",
  },
  recordInnerStop: { width: 34, height: 34, borderRadius: radius.sm - 2, backgroundColor: colors.accentDeep },
  side: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  deniedIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { ...type.caption, color: "#9C4A38", textAlign: "center" },
});
