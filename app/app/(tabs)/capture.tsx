import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ShootingStar } from "../../src/components/brand";
import { AppHeader, Button, Screen, ViewOnlyState } from "../../src/components/ui";
import { useCanContribute } from "../../src/auth/session-context";
import { draft } from "../../src/draft";
import { pickLibraryMedia, takePhoto } from "../../src/pick-media";
import { Ionicons } from "../../src/styled";

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

export default function CaptureRoute() {
  if (!useCanContribute()) {
    return (
      <>
        <AppHeader subtitle="Capture" title="Preserve a moment" />
        <ViewOnlyState onBack={() => router.replace("/")} />
      </>
    );
  }
  return <CaptureScreen />;
}

function CaptureScreen() {
  const [busy, setBusy] = useState<string | null>(null);
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
      const assets = key === "photo" ? await takePhoto() : await pickLibraryMedia();
      if (assets.length) {
        draft.set(assets);
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
        <View className="mb-4 flex-row items-center gap-3">
          <ShootingStar size={46} />
          <Text className="flex-1 type-body">
            However it wants to be remembered — a photo, a voice, or a few sentences.
          </Text>
        </View>

        <View className="gap-3">
          {OPTIONS.map((option) => {
            const open = option.key === "camera" && momentOpen;
            return (
              <View
                key={option.key}
                className={`rounded-lg border bg-surface p-4 ${open ? "border-accent" : "border-line"}`}
              >
                <Pressable
                  onPress={() => choose(option.key)}
                  disabled={busy !== null}
                  accessibilityState={option.key === "camera" ? { expanded: open } : undefined}
                  className="flex-row items-center gap-4 active:opacity-75"
                >
                  <View className="h-[46px] w-[46px] items-center justify-center rounded-full bg-accent-soft">
                    <Ionicons name={option.icon} size={22} colorClassName="accent-accent-deep" />
                  </View>
                  <View className="flex-1">
                    <Text className="type-heading">{option.title}</Text>
                    <Text className="mt-0.5 type-caption">{option.body}</Text>
                  </View>
                  <Ionicons
                    name={open ? "chevron-down" : "chevron-forward"}
                    size={18}
                    colorClassName="accent-muted"
                  />
                </Pressable>
                {open ? (
                  <View className="mt-4 flex-row gap-3">
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
