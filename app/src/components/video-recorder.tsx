import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clock } from "../format";
import { colors, MAX_WIDTH, radius, spacing, type } from "../theme";
import { AppHeader, Button } from "./ui";
import { VideoClip, type VideoMeta } from "./video";

/**
 * The parts of the video recorder that don't care how the frames are made.
 * `app/capture/video.tsx` (expo-camera) and `video.web.tsx` (getUserMedia +
 * MediaRecorder) each own their capture pipeline and render these, so the two
 * look and behave the same.
 */

export type Facing = "front" | "back";

/** Asking for access, or explaining why there isn't any — the light pages around the camera. */
export function RecorderNotice({
  state,
  onRetry,
  message,
}: {
  state: "asking" | "denied" | "insecure" | "unavailable";
  onRetry?: () => void;
  /** For "unavailable": what went wrong, in words. */
  message?: string;
}) {
  const web = Platform.OS === "web";
  return (
    <>
      <AppHeader back subtitle="Capture" title="Record a video" globalActions={false} />
      <View style={styles.notice}>
        {state === "asking" ? (
          <>
            <ActivityIndicator color={colors.accentDeep} />
            <Text style={[type.caption, { marginTop: spacing.md }]}>Asking for the camera and microphone…</Text>
          </>
        ) : (
          <>
            <View style={styles.noticeIcon}>
              <Ionicons name="videocam-off-outline" size={26} color={colors.accentDeep} />
            </View>
            <Text style={[type.heading, { textAlign: "center", marginTop: spacing.lg }]}>
              {state === "unavailable" ? "The camera didn't start" : "Keepsake can't see you yet"}
            </Text>
            <Text style={[type.body, { textAlign: "center", marginTop: spacing.sm, maxWidth: 420 }]}>
              {noticeBody(state, web, message)}
            </Text>
            {state === "insecure" ? null : (
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.xl }}>
                {web || state === "unavailable" ? null : (
                  <Button label="Open settings" icon="settings-outline" onPress={() => void Linking.openSettings()} />
                )}
                <Button
                  label="Try again"
                  variant={web || state === "unavailable" ? "primary" : "secondary"}
                  icon="refresh"
                  onPress={onRetry}
                />
              </View>
            )}
          </>
        )}
      </View>
    </>
  );
}

function noticeBody(state: "denied" | "insecure" | "unavailable", web: boolean, message?: string) {
  if (state === "insecure") {
    return "This page isn't on a secure connection, so the browser won't share the camera. Open Keepsake over https (or on this computer at localhost) to record.";
  }
  if (state === "unavailable") return message;
  if (web) {
    return "Your browser is blocking the camera or microphone for this site. Click the icon beside the address bar, allow both, then come back here.";
  }
  return "To record a video, Keepsake needs the camera and the microphone. You can turn them on in Settings.";
}

function stageHint(recording: boolean, nearlyDone: boolean, maxDurationS: number) {
  if (!recording) return `Up to ${clock(maxDurationS)}. Tap to start.`;
  return nearlyDone ? "Almost out of time — it stops on its own." : "Recording…";
}

/**
 * The live camera: preview behind, controls over it. The timer always shows
 * how much is left, so the cap is never a surprise.
 */
export function RecorderStage({
  preview,
  recording,
  busy,
  elapsedS,
  maxDurationS,
  canFlip,
  onFlip,
  torch,
  onToggleTorch,
  onRecord,
  onStop,
  onClose,
  error,
}: {
  preview: ReactNode;
  recording: boolean;
  /** Starting, stopping, or not ready yet: the button waits. */
  busy: boolean;
  elapsedS: number;
  maxDurationS: number;
  canFlip: boolean;
  onFlip: () => void;
  /** Undefined hides the torch control (front camera, or the web). */
  torch?: boolean;
  onToggleTorch?: () => void;
  onRecord: () => void;
  onStop: () => void;
  onClose: () => void;
  error: string | null;
}) {
  const insets = useSafeAreaInsets();
  // Whole seconds, so elapsed + left always adds up to the cap (0:04 + 1:56).
  const remaining = Math.max(0, maxDurationS - Math.floor(elapsedS));
  const nearlyDone = recording && remaining <= 10;
  return (
    <View style={styles.backdrop}>
      <StatusBar style="light" />
      <View style={styles.stage}>
        <View style={StyleSheet.absoluteFill}>{preview}</View>

        {/* Every control lives down here: the top of the screen is where system
            banners and browser prompts land, and they'd cover anything we put there. */}
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.xl }]}>
          {error ? <Text style={styles.stageError}>{error}</Text> : null}
          <View
            style={[styles.timerPill, recording && styles.timerPillLive]}
            accessibilityLabel={`Elapsed ${clock(elapsedS)}, ${clock(remaining)} left`}
          >
            {recording ? <View style={styles.liveDot} /> : null}
            <Text style={styles.timerText}>{clock(elapsedS)}</Text>
            <Text style={[styles.timerLeft, nearlyDone && { color: colors.terracotta }]}>
              {clock(remaining)} left
            </Text>
          </View>
          <Text style={styles.hint}>{stageHint(recording, nearlyDone, maxDurationS)}</Text>
          <View style={styles.controls}>
            <View style={styles.controlsSide}>
              <RoundButton icon="close" label="Close" onPress={onClose} />
            </View>
            <RecordButton recording={recording} busy={busy} onPress={recording ? onStop : onRecord} />
            <View style={[styles.controlsSide, { justifyContent: "flex-end" }]}>
              {torch !== undefined && onToggleTorch ? (
                <RoundButton
                  icon={torch ? "flashlight" : "flashlight-outline"}
                  label={torch ? "Turn the light off" : "Turn the light on"}
                  onPress={onToggleTorch}
                />
              ) : null}
              {canFlip ? (
                <RoundButton
                  icon="camera-reverse-outline"
                  label="Switch camera"
                  onPress={onFlip}
                  disabled={recording}
                />
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Watch it back, then keep it or try again. */
export function RecorderReview({
  uri,
  onLoad,
  onRetake,
  onUse,
  onClose,
  handingOff,
  error,
}: {
  uri: string;
  onLoad: (meta: VideoMeta) => void;
  onRetake: () => void;
  onUse: () => void;
  onClose: () => void;
  handingOff: boolean;
  error: string | null;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.backdrop}>
      <StatusBar style="light" />
      <View style={[styles.stage, { paddingTop: insets.top + spacing.md }]}>
        <VideoClip key={uri} uri={uri} autoPlay onLoad={onLoad} style={{ flex: 1 }} />
        <View style={[styles.reviewBar, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? <Text style={styles.stageError}>{error}</Text> : null}
          <Text style={styles.hint}>Have a look, then keep it or try again.</Text>
          <Button
            label={handingOff ? "Opening…" : "Use video"}
            icon="checkmark"
            onPress={onUse}
            disabled={handingOff}
            style={{ alignSelf: "stretch" }}
          />
          <View style={styles.controls}>
            <View style={styles.controlsSide}>
              <RoundButton icon="close" label="Close" onPress={onClose} disabled={handingOff} />
            </View>
            <Button label="Retake" variant="secondary" icon="refresh" onPress={onRetake} disabled={handingOff} />
            <View style={styles.controlsSide} />
          </View>
        </View>
      </View>
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

function RoundButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.round, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={colors.surface} />
    </Pressable>
  );
}

const RECORD = 84;
const SCRIM = "rgba(20,24,20,0.45)";

const styles = StyleSheet.create({
  notice: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.bg,
  },
  noticeIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: { flex: 1, backgroundColor: "#000" },
  stage: { flex: 1, width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", backgroundColor: "#000" },
  // Record (or Retake) centred, with equal-width sides so it stays centred
  // whichever side buttons are showing.
  controls: { flexDirection: "row", alignItems: "center", alignSelf: "stretch" },
  controlsSide: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: SCRIM,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
  },
  timerPillLive: { backgroundColor: "rgba(20,24,20,0.6)" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.terracotta },
  timerText: { color: colors.surface, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  timerLeft: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontVariant: ["tabular-nums"] },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  reviewBar: {
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    backgroundColor: "#000",
  },
  hint: { ...type.caption, color: "rgba(255,255,255,0.85)", textAlign: "center" },
  stageError: {
    ...type.caption,
    color: colors.surface,
    backgroundColor: "rgba(156,74,56,0.85)",
    borderRadius: radius.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    textAlign: "center",
    overflow: "hidden",
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: SCRIM,
    alignItems: "center",
    justifyContent: "center",
  },
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
  recordInnerStop: { width: 32, height: 32, borderRadius: radius.sm - 2, backgroundColor: colors.accentDeep },
});
