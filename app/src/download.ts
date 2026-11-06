import { Linking, Platform } from "react-native";
import { mediaUrl } from "./api";

export async function saveFile(url: string, filename: string): Promise<void> {
  const href = mediaUrl(url);
  if (Platform.OS !== "web") {
    await Linking.openURL(href);
    return;
  }
  // The server sends Content-Disposition: attachment; `download` on an anchor
  // only names same-origin files.
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
}

// Several saves from one tap only work in a browser.
export const canSaveSeveral = Platform.OS === "web";
