import { useEffect, useEffectEvent, type RefObject } from "react";
import { isHlsUrl } from "../playback";

/**
 * HLS on the web, for the `.web.tsx` players only — native expo-video plays
 * HLS itself, so nothing on a phone imports this.
 *
 * Mux streams video as HLS (`….m3u8`). Wherever Media Source Extensions
 * exist, hls.js feeds the element, even in browsers that claim native HLS:
 * Chrome's built-in HLS (155) fails Mux streams on segment requests that
 * hls.js loads fine. Native playback is the fallback for browsers without
 * MSE (older iOS Safari). hls.js is loaded on first use, never in the main
 * bundle.
 */

const HLS_MIME = "application/vnd.apple.mpegurl";

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

/**
 * The `src` to give a `<video>` for `uri`. A plain file, or HLS in a browser
 * without MSE that plays it natively, comes straight back. Otherwise this
 * returns undefined (leave `src` off) and attaches hls.js to the element
 * instead; a stream hls.js can't play calls `onError`, like the element's own
 * error.
 */
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
        // hls.js already retries individual requests. A fatal error gets a
        // couple of recoveries first (restart loading, rebuild the decoder)
        // so a CDN blip mid-clip doesn't end playback.
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
