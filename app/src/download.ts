import { Linking, Platform } from "react-native";
import { mediaUrl } from "./api";

/**
 * Save a file the API handed out as a download URL (the memory download
 * sheet). Every such URL answers `Content-Disposition: attachment`, so:
 *
 * - **Web:** a link click. The browser saves it under the server's filename
 *   (`download` on the anchor only names same-origin files; the header does
 *   the rest) and the page stays where it is.
 * - **Native:** hand it to the system browser, which downloads it (Safari's
 *   Downloads, Chrome's download manager). React Native's own `Linking`,
 *   so no new dependency.
 */
export async function saveFile(url: string, filename: string): Promise<void> {
  const href = mediaUrl(url);
  if (Platform.OS !== "web") {
    await Linking.openURL(href);
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
}

/** Whether "Download all" can work here: several saves from one tap only work in a browser. */
export const canSaveSeveral = Platform.OS === "web";
