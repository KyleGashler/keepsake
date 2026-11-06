import { useEffect, useEffectEvent, type RefObject } from "react";
import { isHlsUrl } from "../playback";

const HLS_MIME = "application/vnd.apple.mpegurl";

// hls.js wherever MSE exists, even where native HLS is claimed: Chrome's
// built-in HLS fails Mux streams on segment requests that hls.js loads fine.
let useNativeHls: boolean | undefined;
function prefersNativeHls() {
  if (useNativeHls === undefined) {
    const mse =
      typeof window !== "undefined" &&
      ("MediaSource" in window || "ManagedMediaSource" in window);
    useNativeHls =
      !mse && typeof document !== "undefined" && document.createElement("video").canPlayType(HLS_MIME) !== "";
  }
  return useNativeHls;
}

export function useHlsSource(
  video: RefObject<HTMLVideoElement | null>,
  uri: string,
  onError?: () => void,
): string | undefined {
  const needsHlsJs = isHlsUrl(uri) && !prefersNativeHls();
  const fail = useEffectEvent(() => onError?.());

  useEffect(() => {
    if (!needsHlsJs) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void import("hls.js")
      .then(({ default: Hls }) => {
        const el = video.current;
        if (cancelled || !el) return;
        if (!Hls.isSupported()) return fail();
        const hls = new Hls();
        destroy = () => hls.destroy();
        // hls.js already retries individual requests; a fatal error gets a couple
        // of recoveries so a CDN blip mid-clip doesn't end playback.
        let recoveries = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (recoveries < 2 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recoveries += 1;
            return hls.startLoad();
          }
          if (recoveries < 2 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            recoveries += 1;
            return hls.recoverMediaError();
          }
          destroy?.();
          destroy = undefined;
          fail();
        });
        hls.loadSource(uri);
        hls.attachMedia(el);
      })
      .catch(() => {
        if (!cancelled) fail();
      });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [needsHlsJs, uri, video]);

  return needsHlsJs ? undefined : uri;
}
