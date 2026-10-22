import type { VideoSource } from "expo-video";

/**
 * Video comes back from the API as a signed Mux HLS playlist
 * (`https://stream.mux.com/{playbackId}.m3u8?token=…`); the recorder's
 * review plays a local file. These tell the two apart.
 */

/**
 * An HLS playlist, judged by the path (a signed URL ends in `?token=…`).
 * A regex, not `URL`: React Native's `URL` doesn't implement `pathname`.
 */
export function isHlsUrl(uri: string) {
  return /\.m3u8$/i.test(uri.split(/[?#]/)[0]);
}

/**
 * What expo-video should open: an HLS stream is marked as HLS outright
 * (rather than left to sniffing a signed URL), anything else is its URI.
 */
export function videoSource(uri: string): VideoSource {
  return isHlsUrl(uri) ? { uri, contentType: "hls" } : uri;
}
