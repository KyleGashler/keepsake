import { Platform, Share } from "react-native";

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

// Web only: the native build has no clipboard module.
export async function copyLink(url: string): Promise<"copied" | "dismissed"> {
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // No clipboard on an insecure origin or with permission denied.
    window.prompt("Copy this link", url);
    return "dismissed";
  }
}

export const canCopy = Platform.OS === "web";
