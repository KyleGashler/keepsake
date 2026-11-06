import { RecordingPresets, useAudioPlayer, useAudioPlayerStatus, type RecordingOptions } from "expo-audio";
import { useState } from "react";

export function useClipPlayback(uri: string, durationS?: number | null) {
  // Pinned: a signed playback URL changes on every refetch, and a new source
  // would rebuild the player mid-listen.
  const [source] = useState(uri);
  const player = useAudioPlayer(source, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  // Chrome's MediaRecorder writes WebM with no duration in the header, so the
  // player can report 0.
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
      setTimeout(() => setSeekTarget(null), 400);
    }
  }

  return { playing: status.playing, position, total, failed, toggle, seek, scrub: setScrubbing };
}

// Native writes AAC in .m4a. On the web MediaRecorder gives WebM/Opus, or its
// own default where it can't (older Safari: audio/mp4).
export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 96000,
  isMeteringEnabled: true,
  web: { mimeType: "audio/webm", bitsPerSecond: 96000 },
};

export function normalizeAudioType(rawMime: string | null | undefined, uri: string) {
  const base = (rawMime ?? "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm" || base === "video/webm") return { mime: "audio/webm", ext: ".weba" };
  if (["audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "video/mp4"].includes(base)) {
    return { mime: "audio/mp4", ext: ".m4a" };
  }
  if (base === "audio/mpeg") return { mime: "audio/mpeg", ext: ".mp3" };
  if (base === "audio/wav" || base === "audio/x-wav") return { mime: "audio/wav", ext: ".wav" };
  // Native recordings carry no type at all — the file extension is the truth.
  const path = uri.split("?")[0].toLowerCase();
  if (path.endsWith(".webm") || path.endsWith(".weba")) return { mime: "audio/webm", ext: ".weba" };
  if (path.endsWith(".wav")) return { mime: "audio/wav", ext: ".wav" };
  return { mime: "audio/mp4", ext: ".m4a" };
}

// Metering is dBFS: −160 silence … 0 clipping.
export function levelFromMetering(db: number | undefined) {
  if (db === undefined || !Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 55) / 50));
}
