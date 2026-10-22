import { useEffect, useEffectEvent, type RefObject } from "react";
import { isHlsUrl } from "../playback";

/**
 * HLS on the web, for the `.web.tsx` players only — native expo-video plays
 * HLS itself, so nothing on a phone imports this.
 *
 * Mux streams video as HLS (`….m3u8`). Safari plays that in a plain
 * `<video>`; Chrome and Firefox don't, so there hls.js feeds the element
 * through Media Source Extensions. hls.js is loaded on first use, never in
 * the main bundle.
 */

const HLS_MIME = "application/vnd.apple.mpegurl";

let nativeHls: boolean | undefined;
function playsHlsNatively() {
  if (nativeHls === undefined) {
    nativeHls = typeof document !== "undefined" && document.createElement("video").canPlayType(HLS_MIME) !== "";
  }
  return nativeHls;
}

/**
 * The `src` to give a `<video>` for `uri`. A plain file, or HLS in a browser
 * that plays it natively, comes straight back. Otherwise this returns
 * undefined (leave `src` off) and attaches hls.js to the element instead;
 * a stream hls.js can't play calls `onError`, like the element's own error.
 */
export function useHlsSource(
  video: RefObject<HTMLVideoElement | null>,
  uri: string,
  onError?: () => void,
): string | undefined {
  const needsHlsJs = isHlsUrl(uri) && !playsHlsNatively();
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
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
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
