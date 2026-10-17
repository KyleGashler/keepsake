import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ShootingStar } from "../../src/components/brand";
import { AppHeader, Button, Screen } from "../../src/components/ui";
import { draft, type DraftAsset } from "../../src/draft";
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * Capture should disappear into the background: pick how the moment wants to be
 * preserved, then get out of the way. Every path lands on the same compose
 * screen so nothing is lost if you change your mind halfway through.
 */
const OPTIONS = [
  {
    key: "camera",
    icon: "camera-outline" as const,
    title: "Capture a moment",
    body: "Take a photo, or film a video of what's happening right now.",
  },
  {
    key: "record",
    icon: "mic-outline" as const,
    title: "Record a conversation",
    body: "Keep the voice, not just the words.",
  },
  {
    key: "write",
    icon: "create-outline" as const,
    title: "Tell a story",
    body: "Write it down before the details soften.",
  },
  {
    key: "import",
    icon: "images-outline" as const,
    title: "Import media",
    body: "Bring in photos and videos you've already taken.",
  },
];

/**
 * A picked video's length in whole seconds, or undefined when unknown — the
 * server then transcribes it whatever its length. expo-image-picker documents
 * `duration` in milliseconds, which is what iOS and Android report; its web
 * implementation passes the `<video>` element's `duration` through unchanged,
 * which is seconds (and Infinity for some WebM files).
 */
function pickedDurationS(asset: ImagePicker.ImagePickerAsset): number | undefined {
  if (asset.type !== "video" && !asset.mimeType?.startsWith("video/")) return undefined;
  const raw = asset.duration;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return undefined;
  const seconds = Platform.OS === "web" ? raw : raw / 1000;
  return Math.max(1, Math.round(seconds));
}

function toAssets(assets: ImagePicker.ImagePickerAsset[]): DraftAsset[] {
  return assets.map((asset, i) => ({
    uri: asset.uri,
    name: asset.fileName ?? `capture-${Date.now()}-${i}.jpg`,
    mime: asset.mimeType ?? "image/jpeg",
    width: asset.width,
    height: asset.height,
    bytes: asset.fileSize,
    durationS: pickedDurationS(asset),
  }));
}

export default function CaptureScreen() {
  const [busy, setBusy] = useState<string | null>(null);
  // "Capture a moment" opens in place to ask which: a photo or a video.
  const [momentOpen, setMomentOpen] = useState(false);

  async function choose(key: string) {
    if (key === "camera") return setMomentOpen((open) => !open);
    if (key === "write") return router.push("/capture/compose");
    if (key === "record") return router.push("/capture/record");
    if (key === "video") {
      setMomentOpen(false);
      return router.push("/capture/video");
    }

    setBusy(key);
    try {
      const result =
        key === "photo"
          ? await (async () => {
              const perm = await ImagePicker.requestCameraPermissionsAsync();
              if (!perm.granted) return null;
              // Video has its own recorder, with a length cap the upload can honour.
              return ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
            })()
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images", "videos"],
              allowsMultipleSelection: true,
              quality: 0.9,
            });

      if (result && !result.canceled && result.assets?.length) {
        draft.set(toAssets(result.assets));
        setMomentOpen(false);
        router.push("/capture/compose");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AppHeader subtitle="Capture" title="Preserve a moment" />
      <Screen>
        {/* Whimsical shape 4/6 — shooting star, for the moment that's going past. */}
        <View style={styles.intro}>
          <ShootingStar size={46} />
          <Text style={[type.body, { flex: 1 }]}>
            However it wants to be remembered — a photo, a voice, or a few sentences.
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          {OPTIONS.map((option) => {
            const open = option.key === "camera" && momentOpen;
            return (
              <View key={option.key} style={[styles.option, open && styles.optionOpen]}>
                <Pressable
                  onPress={() => choose(option.key)}
                  disabled={busy !== null}
                  accessibilityState={option.key === "camera" ? { expanded: open } : undefined}
                  style={({ pressed }) => [styles.optionRow, pressed && { opacity: 0.75 }]}
                >
                  <View style={styles.optionIcon}>
                    <Ionicons name={option.icon} size={22} color={colors.accentDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={type.heading}>{option.title}</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>{option.body}</Text>
                  </View>
                  <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={18} color={colors.muted} />
                </Pressable>
                {open ? (
                  <View style={styles.momentChoices}>
                    <Button
                      label={busy === "photo" ? "Opening…" : "Photo"}
                      icon="camera-outline"
                      variant="secondary"
                      onPress={() => choose("photo")}
                      disabled={busy !== null}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Video"
                      icon="videocam-outline"
                      variant="secondary"
                      onPress={() => choose("video")}
                      disabled={busy !== null}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  optionOpen: { borderColor: colors.accent },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  momentChoices: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
