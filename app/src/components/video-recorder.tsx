import { StatusBar } from "expo-status-bar";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clock } from "../format";
import { Ionicons } from "../styled";
import { AppHeader, Button } from "./ui";
import { VideoClip, type VideoMeta } from "./video";

/**
 * The parts of the video recorder that don't care how the frames are made.
 * `app/capture/video.tsx` (expo-camera) and `video.web.tsx` (getUserMedia +
 * MediaRecorder) each own their capture pipeline and render these, so the two
 * look and behave the same.
 */

export type Facing = "front" | "back";

/** The camera's black column, capped like every page so a wide browser keeps the phone layout. */
const STAGE = "w-full max-w-page flex-1 self-center bg-black";
// Record (or Retake) centred, with equal-width sides so it stays centred
// whichever side buttons are showing.
const CONTROLS = "flex-row items-center self-stretch";
const CONTROLS_SIDE = "flex-1 flex-row items-center gap-2";
const HINT = "text-center type-caption text-white/85";
const STAGE_ERROR = "overflow-hidden rounded-sm bg-error/85 px-3 py-1.5 text-center type-caption text-surface";

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
      <View className="flex-1 items-center justify-center bg-paper px-6 py-12">
        {state === "asking" ? (
          <>
            <ActivityIndicator colorClassName="accent-accent-deep" />
            <Text className="mt-3 type-caption">Asking for the camera and microphone…</Text>
          </>
        ) : (
          <>
            <View className="h-[60px] w-[60px] items-center justify-center rounded-full bg-accent-soft">
              <Ionicons name="videocam-off-outline" size={26} colorClassName="accent-accent-deep" />
            </View>
            <Text className="mt-4 text-center type-heading">
              {state === "unavailable" ? "The camera didn't start" : "We can't see you yet"}
            </Text>
            <Text className="mt-2 max-w-[420px] text-center type-body">{noticeBody(state, web, message)}</Text>
            {state === "insecure" ? null : (
              <View className="mt-6 flex-row gap-3">
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
    return "This page isn't on a secure connection, so the browser won't share the camera. Open little by little over https (or on this computer at localhost) to record.";
  }
  if (state === "unavailable") return message;
  if (web) {
    return "Your browser is blocking the camera or microphone for this site. Click the icon beside the address bar, allow both, then come back here.";
  }
  return "To record a video, little by little needs the camera and the microphone. You can turn them on in Settings.";
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
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <View className={STAGE}>
        <View className="absolute inset-0">{preview}</View>

        {/* Every control lives down here: the top of the screen is where system
            banners and browser prompts land, and they'd cover anything we put there. */}
        <View
          className="absolute inset-x-0 bottom-0 items-center gap-3 px-4 pt-4"
          style={{ paddingBottom: insets.bottom + 24 }}
        >
          {error ? <Text className={STAGE_ERROR}>{error}</Text> : null}
          <View
            className={`flex-row items-center gap-2 rounded-full px-3 py-[7px] ${
              recording ? "bg-logo-ink/60" : "bg-logo-ink/45"
            }`}
            accessibilityLabel={`Elapsed ${clock(elapsedS)}, ${clock(remaining)} left`}
          >
            {recording ? <View className="h-2 w-2 rounded-[4px] bg-terracotta" /> : null}
            <Text className="text-[15px] font-semibold text-surface tabular-nums">{clock(elapsedS)}</Text>
            <Text className={`text-[13px] tabular-nums ${nearlyDone ? "text-terracotta" : "text-white/75"}`}>
              {clock(remaining)} left
            </Text>
          </View>
          <Text className={HINT}>{stageHint(recording, nearlyDone, maxDurationS)}</Text>
          <View className={CONTROLS}>
            <View className={CONTROLS_SIDE}>
              <RoundButton icon="close" label="Close" onPress={onClose} />
            </View>
            <RecordButton recording={recording} busy={busy} onPress={recording ? onStop : onRecord} />
            <View className={`${CONTROLS_SIDE} justify-end`}>
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
    <View className="flex-1 bg-black">
      <StatusBar style="light" />
      <View className={STAGE} style={{ paddingTop: insets.top + 12 }}>
        <VideoClip key={uri} uri={uri} autoPlay onLoad={onLoad} className="flex-1" />
        <View
          className="items-center gap-3 bg-black px-4 pt-4"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          {error ? <Text className={STAGE_ERROR}>{error}</Text> : null}
          <Text className={HINT}>Have a look, then keep it or try again.</Text>
          <Button
            label={handingOff ? "Opening…" : "Use video"}
            icon="checkmark"
            onPress={onUse}
            disabled={handingOff}
            style={{ alignSelf: "stretch" }}
          />
          <View className={CONTROLS}>
            <View className={CONTROLS_SIDE}>
              <RoundButton icon="close" label="Close" onPress={onClose} disabled={handingOff} />
            </View>
            <Button label="Retake" variant="secondary" icon="refresh" onPress={onRetake} disabled={handingOff} />
            <View className={CONTROLS_SIDE} />
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
      className="h-[84px] w-[84px] items-center justify-center rounded-[42px] border-4 border-accent-soft bg-surface active:opacity-80"
    >
      <View
        className={`items-center justify-center ${
          recording ? "h-8 w-8 rounded-[8px] bg-accent-deep" : "h-[62px] w-[62px] rounded-[31px] bg-terracotta"
        }`}
      >
        {busy ? <ActivityIndicator colorClassName="accent-surface" /> : null}
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
  icon: ComponentProps<typeof Ionicons>["name"];
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
      className={`h-11 w-11 items-center justify-center rounded-full bg-logo-ink/45 active:opacity-70 ${
        disabled ? "opacity-35" : ""
      }`}
    >
      <Ionicons name={icon} size={20} colorClassName="accent-surface" />
    </Pressable>
  );
}
