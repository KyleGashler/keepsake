import type { VideoSource } from "expo-video";

// A regex, not `URL`: React Native's `URL` doesn't implement `pathname`.
export function isHlsUrl(uri: string) {
  return /\.m3u8$/i.test(uri.split(/[?#]/)[0]);
}

// Marked as HLS outright rather than left to expo-video sniffing a signed URL.
export function videoSource(uri: string): VideoSource {
  return isHlsUrl(uri) ? { uri, contentType: "hls" } : uri;
}
