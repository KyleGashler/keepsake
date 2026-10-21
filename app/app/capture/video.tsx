import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { File as FsFile } from "expo-file-system";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useApi, type UploadLimits } from "../../src/api";
import type { VideoMeta } from "../../src/components/video";
import { confirmDiscard } from "../../src/confirm";
import {
  RecorderNotice,
  RecorderReview,
  RecorderStage,
  type Facing,
} from "../../src/components/video-recorder";
import { draft } from "../../src/draft";
import { errorMessage } from "../../src/format";
import { FALLBACK_MAX_UPLOAD_BYTES, NATIVE_VIDEO, normalizeVideoType, recordingBudget } from "../../src/video";

type Phase = "asking" | "denied" | "ready" | "recording" | "stopping" | "review";

type Clip = { uri: string; durationS: number; width?: number; height?: number };

/** A recording shorter than this can fail to finalise on Android; Stop waits for it. */
const MIN_RECORDING_MS = 1000;

/**
 * The in-app video recorder (iOS and Android; the web build uses
 * `video.web.tsx`). A full-screen camera with a hard length cap derived from
 * the upload ceiling, then a review step. Nothing is uploaded here — "Use
 * video" hands the clip to compose like any other captured media.
 *
 * The camera is released by unmounting it: the review step renders the
 * player instead, and leaving the screen unmounts everything.
 */
export default function VideoScreen() {
  const params = useLocalSearchParams<{ prompt?: string; collectionId?: string }>();
  const { data: limits, error: limitsError } = useApi<UploadLimits>("/api/media/limits");
  const maxBytes = limits?.maxUploadBytes ?? (limitsError ? FALLBACK_MAX_UPLOAD_BYTES : null);
  const budget = maxBytes
    ? recordingBudget(maxBytes, NATIVE_VIDEO.videoBitrate + NATIVE_VIDEO.audioAllowance)
    : null;

  const [, requestCamera] = useCameraPermissions();
  const [, requestMicrophone] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  // The ref detaches before unmount cleanups run, so the one that's recording
  // is held separately to stop it on the way out.
  const liveCameraRef = useRef<CameraView | null>(null);
  const mountedRef = useRef(true);
  const discardedRef = useRef(false);
  const startedAtRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("asking");
  const [facing, setFacing] = useState<Facing>("back");
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
      discardedRef.current = true;
      try {
        liveCameraRef.current?.stopRecording();
      } catch {
        // The view may already be gone, which stops the recording anyway.
      }
    },
    [],
  );

  async function askForAccess() {
    setPhase("asking");
    const granted = await accessGranted(requestCamera, requestMicrophone);
    if (mountedRef.current) setPhase(granted ? "ready" : "denied");
  }

  useEffect(() => {
    let cancelled = false;
    const ask = async () => {
      const granted = await accessGranted(requestCamera, requestMicrophone);
      if (!cancelled) setPhase(granted ? "ready" : "denied");
    };
    void ask();
    return () => {
      cancelled = true;
    };
  }, [requestCamera, requestMicrophone]);

  // The clock, and a backstop in case the native cap is ever late.
  const maxDurationS = budget?.maxDurationS;
  useEffect(() => {
    if (phase !== "recording" || maxDurationS === undefined) return;
    const timer = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms > (maxDurationS + 2) * 1000) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase, maxDurationS]);

  async function start() {
    const camera = cameraRef.current;
    if (!camera || !budget) return;
    setError(null);
    discardedRef.current = false;
    liveCameraRef.current = camera;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setPhase("recording");
    try {
      // Resolves when Stop is pressed or either cap is reached. On iOS the
      // bitrate only applies when a codec is named; H.264 also plays in every
      // browser, where an HEVC original might not.
      const result = await camera.recordAsync({
        maxDuration: budget.maxDurationS,
        maxFileSize: budget.maxFileSize,
        ...(Platform.OS === "ios" ? { codec: "avc1" as const } : {}),
      });
      const ms = Date.now() - startedAtRef.current;
      liveCameraRef.current = null;
      if (!mountedRef.current || discardedRef.current) return;
      if (!result?.uri) throw new Error("No video was saved.");
      setClip({ uri: result.uri, durationS: Math.max(1, Math.round(ms / 1000)) });
      setTorch(false);
      setPhase("review");
    } catch (err) {
      liveCameraRef.current = null;
      if (!mountedRef.current || discardedRef.current) return;
      setError(`The video couldn't be saved. ${errorMessage(err)}`.trim());
      setPhase("ready");
    }
  }

  function stop() {
    setPhase("stopping");
    // A tap straight after starting is held until the file has something in it.
    const wait = MIN_RECORDING_MS - (Date.now() - startedAtRef.current);
    if (wait > 0) setTimeout(() => liveCameraRef.current?.stopRecording(), wait);
    else liveCameraRef.current?.stopRecording();
  }

  async function closeAsked() {
    if (phase === "recording" || phase === "stopping" || phase === "review") {
      if (!(await confirmDiscard())) return;
      discardedRef.current = true;
      liveCameraRef.current?.stopRecording();
    }
    close();
  }

  function retake() {
    setClip(null);
    setError(null);
    setElapsedMs(0);
    setCameraReady(false);
    setPhase("ready");
  }

  function onReviewLoad(meta: VideoMeta) {
    // The player's reading beats the stopwatch, and the camera reports no size.
    setClip((current) =>
      current
        ? {
            ...current,
            durationS: meta.durationS ? Math.max(1, Math.round(meta.durationS)) : current.durationS,
            width: meta.width ?? current.width,
            height: meta.height ?? current.height,
          }
        : current,
    );
  }

  function keepVideo() {
    if (!clip) return;
    setHandingOff(true);
    setError(null);
    let bytes: number | undefined;
    try {
      bytes = new FsFile(clip.uri).size;
    } catch {
      // Size is only for compose's early over-the-limit check; init still enforces it.
    }
    const { mime, ext } = normalizeVideoType(null, clip.uri);
    draft.set([
      {
        uri: clip.uri,
        name: `video-${Date.now()}${ext}`,
        mime,
        bytes,
        width: clip.width,
        height: clip.height,
        durationS: clip.durationS,
      },
    ]);
    router.replace({
      pathname: "/capture/compose",
      params: {
        mode: "video",
        ...(params.prompt ? { prompt: params.prompt } : {}),
        ...(params.collectionId ? { collectionId: params.collectionId } : {}),
      },
    });
  }

  if (phase === "asking" || !budget) return <RecorderNotice state="asking" />;
  if (phase === "denied") return <RecorderNotice state="denied" onRetry={askForAccess} />;

  if (phase === "review" && clip) {
    return (
      <RecorderReview
        uri={clip.uri}
        onLoad={onReviewLoad}
        onRetake={retake}
        onUse={keepVideo}
        onClose={closeAsked}
        handingOff={handingOff}
        error={error}
      />
    );
  }

  const recording = phase === "recording" || phase === "stopping";
  return (
    <RecorderStage
      preview={
        <CameraView
          ref={cameraRef}
          style={{ flex: 1 }}
          mode="video"
          facing={facing}
          enableTorch={torch && facing === "back"}
          videoQuality={NATIVE_VIDEO.quality}
          videoBitrate={NATIVE_VIDEO.videoBitrate}
          onCameraReady={() => setCameraReady(true)}
          onMountError={({ message }) => setError(`The camera didn't start. ${message ?? ""}`.trim())}
        />
      }
      recording={recording}
      busy={!cameraReady || phase === "stopping"}
      elapsedS={elapsedMs / 1000}
      maxDurationS={budget.maxDurationS}
      // The stage disables this while recording: switching ends a recording.
      canFlip
      onFlip={() => setFacing((f) => (f === "back" ? "front" : "back"))}
      torch={facing === "back" ? torch : undefined}
      onToggleTorch={() => setTorch((on) => !on)}
      onRecord={start}
      onStop={stop}
      onClose={closeAsked}
      error={error}
    />
  );
}

/** Camera first; the microphone is only asked for once the camera is allowed. */
async function accessGranted(
  requestCamera: () => Promise<{ granted: boolean }>,
  requestMicrophone: () => Promise<{ granted: boolean }>,
) {
  const camera = await requestCamera()
    .then((perm) => perm.granted)
    .catch(() => false);
  if (!camera) return false;
  return requestMicrophone()
    .then((perm) => perm.granted)
    .catch(() => false);
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/capture");
}
