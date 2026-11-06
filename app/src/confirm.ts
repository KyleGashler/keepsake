import { Alert, Platform } from "react-native";

// Alert has no web implementation, so the browser's dialog stands in. Use this
// where a sheet is already up: a second Modal can't stack over the first.
export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
}): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export function confirmDiscard(): Promise<boolean> {
  return confirmAction({
    title: "Discard this video?",
    message: "It hasn't been saved anywhere yet.",
    confirmLabel: "Discard",
    cancelLabel: "Keep it",
  });
}
