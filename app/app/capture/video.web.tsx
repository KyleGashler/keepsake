import { router, useLocalSearchParams } from "expo-router";
import { createElement, useEffect, useRef, useState } from "react";
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
import {
  FALLBACK_MAX_UPLOAD_BYTES,
  normalizeVideoType,
  pickWebVideoMimeType,
  recordingBudget,
  WEB_VIDEO,
} from "../../src/video";

type Phase = "asking" | "denied" | "insecure" | "unavailable" | "ready" | "recording" | "stopping" | "review";

type Clip = { uri: string; durationS: number; bytes: number; mime: string; width?: number; height?: number };

const BITS_PER_SECOND = WEB_VIDEO.videoBitsPerSecond + WEB_VIDEO.audioBitsPerSecond;
/** MediaRecorder hands over a chunk this often, which is how bytes are counted. */
const TIMESLICE_MS = 1000;

/**
 * The web recorder. expo-camera can't record in a browser, so this is
 * `getUserMedia` + `MediaRecorder` directly, behind the same UI and the same
 * cap as the native screen (`video.tsx`).
 *
 * The camera light is the contract: tracks are stopped as soon as a recording
 * ends (the review plays the file, not the camera), on retake they're asked
 * for again, and leaving the screen stops everything.
 */
export default function VideoWebScreen() {
  const params = useLocalSearchParams<{ prompt?: string; collectionId?: string }>();
  const { data: limits, error: limitsError } = useApi<UploadLimits>("/api/media/limits");
  const maxBytes = limits?.maxUploadBytes ?? (limitsError ? FALLBACK_MAX_UPLOAD_BYTES : null);
  const budget = maxBytes ? recordingBudget(maxBytes, BITS_PER_SECOND) : null;

  const [phase, setPhase] = useState<Phase>(() => unsupported()?.phase ?? "asking");
  const [unavailable, setUnavailable] = useState(() => unsupported()?.message ?? "");
  const [facing, setFacing] = useState<Facing>("back");
  // What the browser actually opened: a laptop webcam reports no facing at all.
  const [mirrored, setMirrored] = useState(true);
  const [canFlip, setCanFlip] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(false);

  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardedRef = useRef(false);
  const startedAtRef = useRef(0);
  const clipUrlRef = useRef<string | null>(null);
  const handedOffRef = useRef(false);

  function releaseCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) setStream(null);
  }

  function forgetClip() {
    if (clipUrlRef.current && !handedOffRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
  }

  useEffect(
    () => () => {
      mountedRef.current = false;
      discardedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseCamera();
      forgetClip();
    },
    [],
  );

  async function openCamera(which: Facing) {
    setPhase("asking");
    setError(null);
    releaseCamera();
    const reason = unsupported();
    if (reason) {
      setUnavailable(reason.message);
      setPhase(reason.phase);
      return;
    }
    await connectCamera(which);
  }

  /** Ask for the camera and microphone; the browser's checks have already passed. */
  async function connectCamera(which: Facing) {
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: which === "front" ? "user" : "environment",
          width: { ideal: WEB_VIDEO.width },
          height: { ideal: WEB_VIDEO.height },
        },
        audio: true,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPhase("denied");
        return;
      }
      setUnavailable(cameraFailure(name, err));
      setPhase("unavailable");
      return;
    }
    if (!mountedRef.current) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = media;
    setStream(media);
    setFacing(which);
    setMirrored(media.getVideoTracks()[0]?.getSettings().facingMode !== "environment");
    // Only phones (and the odd desktop with two webcams) have a camera to flip to.
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (mountedRef.current) setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch(() => {
        // Without the device list there's no flip button, which is safe.
      });
    setPhase("ready");
  }

  useEffect(() => {
    // The back camera on a phone ("capture a moment"); a desktop has only one.
    // An unsupported browser already says so from the first render.
    if (!unsupported()) void connectCamera("back");
  }, []);

  // The clock, and the length cap: the browser has no maxDuration of its own.
  const maxDurationS = budget?.maxDurationS;
  useEffect(() => {
    if (phase !== "recording" || maxDurationS === undefined) return;
    const timer = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      if (ms >= maxDurationS * 1000) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [phase, maxDurationS]);

  function start() {
    const media = streamRef.current;
    const mimeType = pickWebVideoMimeType();
    if (!media || !mimeType || !budget) return;
    setError(null);
    discardedRef.current = false;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(media, {
        mimeType,
        videoBitsPerSecond: WEB_VIDEO.videoBitsPerSecond,
        audioBitsPerSecond: WEB_VIDEO.audioBitsPerSecond,
      });
    } catch (err) {
      setError(`Recording didn't start. ${errorMessage(err)}`.trim());
      return;
    }

    const chunks: Blob[] = [];
    let bytes = 0;
    // Stop with two chunks' worth of room left: the encoder's bitrate is a
    // target, and the last chunk lands after stop() is called.
    const byteStop = budget.maxFileSize - (BITS_PER_SECOND / 8) * (TIMESLICE_MS / 1000) * 2;
    const settings = media.getVideoTracks()[0]?.getSettings();

    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data.size) return;
      chunks.push(event.data);
      bytes += event.data.size;
      if (bytes >= byteStop && recorder.state === "recording") stop();
    });
    recorder.addEventListener("error", () => {
      if (!mountedRef.current) return;
      setError("Recording stopped unexpectedly.");
    });
    recorder.addEventListener("stop", () => {
      recorderRef.current = null;
      const ms = Date.now() - startedAtRef.current;
      // The review plays the file, so the camera can go dark now.
      releaseCamera();
      if (!mountedRef.current || discardedRef.current) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (!blob.size) {
        setError("Nothing was recorded. Try again.");
        void openCamera(facing);
        return;
      }
      forgetClip();
      const uri = URL.createObjectURL(blob);
      clipUrlRef.current = uri;
      setClip({
        uri,
        durationS: Math.max(1, Math.round(ms / 1000)),
        bytes: blob.size,
        mime: blob.type,
        width: settings?.width,
        height: settings?.height,
      });
      setPhase("review");
    });

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start(TIMESLICE_MS);
    setPhase("recording");
  }

  function stop() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setPhase("stopping");
    recorder.stop();
  }

  async function closeAsked() {
    if (phase === "recording" || phase === "stopping" || phase === "review") {
      if (!(await confirmDiscard())) return;
      discardedRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
    }
    close();
  }

  function retake() {
    forgetClip();
    setClip(null);
    setElapsedMs(0);
    void openCamera(facing);
  }

  function onReviewLoad(meta: VideoMeta) {
    // The file's own size beats the stream's settings: a phone held upright
    // reports a landscape stream but records a portrait picture.
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
    handedOffRef.current = true;
    const { mime, ext } = normalizeVideoType(clip.mime, clip.uri);
    draft.set([
      {
        uri: clip.uri,
        name: `video-${Date.now()}${ext}`,
        mime,
        bytes: clip.bytes,
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
  if (phase === "denied" || phase === "insecure" || phase === "unavailable") {
    return <RecorderNotice state={phase} message={unavailable} onRetry={() => void openCamera(facing)} />;
  }

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
      preview={<Preview stream={stream} mirrored={mirrored} />}
      recording={recording}
      busy={!stream || phase === "stopping"}
      elapsedS={elapsedMs / 1000}
      maxDurationS={budget.maxDurationS}
      canFlip={canFlip}
      onFlip={() => void openCamera(facing === "front" ? "back" : "front")}
      onRecord={start}
      onStop={stop}
      onClose={closeAsked}
      error={error}
    />
  );
}

/**
 * Why this browser can't record at all, before anything is asked of the user.
 * Browsers only expose the camera on https or localhost; on plain http the API
 * simply isn't there.
 */
function unsupported(): { phase: "insecure" | "unavailable"; message: string } | null {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return { phase: "insecure", message: "" };
  if (!pickWebVideoMimeType()) {
    return {
      phase: "unavailable",
      message: "This browser can't record video. Try a recent Chrome, Safari, Edge or Firefox.",
    };
  }
  return null;
}

/** What to say when `getUserMedia` fails for a reason other than a refusal. */
function cameraFailure(name: string, err: unknown) {
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera or microphone was found. Plug one in, or try another device.";
  }
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then try again.";
  return errorMessage(err, "Something went wrong.");
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/capture");
}

/**
 * The live picture. Muted so the room doesn't echo back through the
 * speakers, and mirrored for a camera facing you the way every selfie view is —
 * the recording itself is not mirrored.
 */
function Preview({ stream, mirrored }: { stream: MediaStream | null; mirrored: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === stream) return;
    // Set here as well as in props: React doesn't always write `muted` to the
    // element, and Safari won't autoplay a stream without it.
    el.muted = true;
    el.srcObject = stream;
    if (stream) {
      el.play().catch(() => {
        // Interrupted by the next stream, or autoplay refused: nothing to undo.
      });
    }
  }, [stream]);
  // oxlint-disable-next-line react/refs -- handing the ref to the element is how it attaches; nothing reads it here
  return createElement("video", {
    ref,
    autoPlay: true,
    muted: true,
    playsInline: true,
    className: `block h-full w-full bg-black object-cover ${mirrored ? "-scale-x-100" : ""}`,
  });
}
