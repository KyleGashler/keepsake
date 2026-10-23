import { Platform, Share } from "react-native";

/**
 * Passing a link on: the system share sheet natively; on the web, the
 * browser's share sheet where there is one (phones), else the clipboard.
 * Resolves to what happened so the caller can say "Copied".
 */
export async function shareLink(url: string, message: string): Promise<"shared" | "copied" | "dismissed"> {
  if (Platform.OS === "web") {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: message, url });
        return "shared";
      } catch {
        // Dismissed, or not allowed here: fall back to copying.
      }
    }
    return copyLink(url);
  }
  const result = await Share.share({ message: `${message}\n${url}` });
  return result.action === Share.sharedAction ? "shared" : "dismissed";
}

/**
 * Web only: put the link on the clipboard. There's no clipboard module in
 * the native build; there the share sheet has its own "Copy".
 */
export async function copyLink(url: string): Promise<"copied" | "dismissed"> {
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // No clipboard access (an insecure origin, a denied permission): let the
    // person copy it by hand.
    window.prompt("Copy this link", url);
    return "dismissed";
  }
}

/** Whether `copyLink` can be offered alongside sharing. */
export const canCopy = Platform.OS === "web";
