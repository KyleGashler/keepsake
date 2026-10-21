import { Alert, Platform } from "react-native";

/** Alert has no web implementation, so the browser's own dialog stands in. */
export function confirmDiscard(): Promise<boolean> {
  const title = "Discard this video?";
  const message = "It hasn't been saved anywhere yet.";
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "Keep it", style: "cancel", onPress: () => resolve(false) },
        { text: "Discard", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
