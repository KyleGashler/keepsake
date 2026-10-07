import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShootingStar } from "../../src/components/brand";
import { AppHeader, PreviewNote, Screen } from "../../src/components/ui";
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
    body: "Take a photo or video of what's happening right now.",
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

function toAssets(assets: ImagePicker.ImagePickerAsset[]): DraftAsset[] {
  return assets.map((asset, i) => ({
    uri: asset.uri,
    name: asset.fileName ?? `capture-${Date.now()}-${i}.jpg`,
    mime: asset.mimeType ?? "image/jpeg",
    width: asset.width,
    height: asset.height,
    bytes: asset.fileSize,
  }));
}

export default function CaptureScreen() {
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(key: string) {
    if (key === "write") return router.push("/capture/compose");
    if (key === "record") return router.push({ pathname: "/capture/compose", params: { mode: "audio" } });

    setBusy(key);
    try {
      const result =
        key === "camera"
          ? await (async () => {
              const perm = await ImagePicker.requestCameraPermissionsAsync();
              if (!perm.granted) return null;
              return ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 0.9 });
            })()
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images", "videos"],
              allowsMultipleSelection: true,
              quality: 0.9,
            });

      if (result && !result.canceled && result.assets?.length) {
        draft.set(toAssets(result.assets));
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
          {OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => choose(option.key)}
              disabled={busy !== null}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.75 }]}
            >
              <View style={styles.optionIcon}>
                <Ionicons name={option.icon} size={22} color={colors.accentDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.heading}>{option.title}</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>{option.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        <PreviewNote>
          Audio capture opens the written form for now — recording, transcription, and AI narratives are the
          next milestone.
        </PreviewNote>
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
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
});
