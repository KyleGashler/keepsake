import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  apiSend,
  uploadFile,
  useApi,
  type Collection,
  type Memory,
  type PillarKey,
  type Person,
  tooLargeMessage,
  type UploadLimits,
} from "../../src/api";
import { AudioClip } from "../../src/components/audio";
import { VideoClip } from "../../src/components/video";
import { AppHeader, Button, Loading, Screen, ViewOnlyState } from "../../src/components/ui";
import { useCanContribute, useSession } from "../../src/auth/session-context";
import { draft, type DraftAsset } from "../../src/draft";
import { duration, errorMessage } from "../../src/format";
import { Image, Ionicons } from "../../src/styled";

/** Every text field's box; each sets its own text size (the story's is larger). */
const INPUT = "rounded-md border border-line bg-surface px-4 py-[13px] text-ink";

const PILLARS: PillarKey[] = ["ARRIVAL_STORIES", "CHILD_PROFILES", "FAMILY_LIFE"];

const PILLAR_LABELS: Record<PillarKey, string> = {
  ARRIVAL_STORIES: "Arrival",
  CHILD_PROFILES: "Children",
  FAMILY_LIFE: "Family Life",
};

/** Local date, not UTC — an evening capture belongs to today, not tomorrow. */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Accepts YYYY-MM-DD; falls back to now so a typo can't lose the memory. */
function toIso(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Only someone who may add to the family composes; a VIEWER is told why not. */
export default function ComposeRoute() {
  if (!useCanContribute()) {
    return (
      <>
        <AppHeader back subtitle="Capture" title="Preserve a moment" />
        <ViewOnlyState onBack={() => router.replace("/")} />
      </>
    );
  }
  return <ComposeScreen />;
}

function ComposeScreen() {
  const params = useLocalSearchParams<{ prompt?: string; collectionId?: string; mode?: string }>();
  const { data: peopleData } = useApi<{ people: Person[] }>("/api/people");
  const { data: collectionsData } = useApi<{ collections: Collection[] }>("/api/collections");
  const { data: limits } = useApi<UploadLimits>("/api/media/limits");
  const session = useSession();

  // Media picked in Capture is handed over once, on mount.
  const [assets] = useState(() => draft.take());
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState("");
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    params.collectionId ? [params.collectionId] : [],
  );
  const [pillar, setPillar] = useState<PillarKey>("FAMILY_LIFE");
  const [saving, setSaving] = useState(false);
  // Uploads happen before the memory is written, and a video can take a while;
  // say what's happening rather than leaving one word on the button.
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Said up front, before anyone writes a story for a video that can't be kept.
  // Assets whose size the picker didn't report are caught by init's 413 instead.
  const oversized = limits ? assets.find((a) => a.bytes !== undefined && a.bytes > limits.maxUploadBytes) : undefined;
  const oversizedMessage = oversized && limits ? tooLargeMessage(oversized.mime, limits.maxUploadBytes) : null;

  // Audio rides as a playable card, never through <Image>.
  const recordings = assets.filter((a) => a.mime.startsWith("audio/"));
  const visuals = assets.filter((a) => !a.mime.startsWith("audio/"));
  const audioMode = params.mode === "audio" || recordings.length > 0;
  const hasVideo = visuals.some((a) => a.mime.startsWith("video/"));
  // Arrived from the video recorder without its clip (a reload drops the draft).
  const missingVideo = params.mode === "video" && !visuals.length;

  const people = peopleData?.people ?? [];
  // Whoever is writing, by default: their own Person in this family (a
  // grandparent who joined by invite writes as themselves), else the first
  // parent, as before memberships carried one.
  const self = session.family?.personId;
  const author =
    authorId ??
    (self && people.some((p) => p.id === self) ? self : null) ??
    people.find((p) => p.role === "PARENT")?.id ??
    people[0]?.id ??
    null;

  const collections = useMemo(
    () => (collectionsData?.collections ?? []).filter((c) => c.pillar === pillar),
    [collectionsData, pillar],
  );
  const chosen = useMemo(
    () => (collectionsData?.collections ?? []).filter((c) => collectionIds.includes(c.id)),
    [collectionsData, collectionIds],
  );

  async function save() {
    if (!title.trim()) return setError("Give the memory a title so it can be found again.");
    setSaving(true);
    setError(null);
    try {
      const media = [];
      for (const [i, asset] of assets.entries()) {
        const label = assets.length > 1 ? `${i + 1} of ${assets.length}` : "";
        setProgress(label ? `Uploading ${label}…` : "Uploading…");
        const uploaded = await uploadFile(asset.uri, asset.name, asset.mime, (fraction) =>
          setProgress(`Uploading ${label} ${Math.round(fraction * 100)}%`.replace(/\s+/g, " ").trim()),
        );
        // Everything but the caption comes from the server's own reading of the
        // bytes; the picker's dimensions only fill in what it couldn't measure.
        // Audio has no dimensions to send; a clip's length comes from the
        // recorder (or Mux fills it in once the clip is processed).
        const audio = uploaded.type === "AUDIO";
        const timed = audio || uploaded.type === "VIDEO";
        media.push({
          type: uploaded.type,
          storageKey: uploaded.key,
          mimeType: uploaded.mimeType,
          bytes: uploaded.bytes,
          // Whichever digest finalize recorded: storage's checksum, or its own
          // sha256. A Mux clip has neither (Mux validates the file itself).
          ...(uploaded.checksum ? { checksum: uploaded.checksum } : {}),
          ...(uploaded.sha256 ? { sha256: uploaded.sha256 } : {}),
          ...(timed && asset.durationS && asset.durationS > 0 ? { durationS: Math.round(asset.durationS) } : {}),
          ...(audio
            ? {}
            : {
                width: uploaded.width ?? asset.width ?? 1200,
                height: uploaded.height ?? asset.height ?? 900,
              }),
        });
      }
      setProgress(assets.length ? "Preserving…" : null);

      const res = await apiSend<{ memory: Memory }>("/api/memories", "POST", {
        title: title.trim(),
        story: story.trim() || undefined,
        occurredAt: toIso(date),
        location: location.trim() || undefined,
        authorId: author ?? undefined,
        participantIds,
        collectionIds,
        media,
      });

      router.replace(`/memory/${res.memory.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  if (!peopleData || !collectionsData) return <Loading label="Opening the archive…" />;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader back subtitle="Capture" title="New memory" globalActions={false} />
      <Screen>
        <View className="gap-6">
          {params.prompt ? (
            <View className="flex-row items-center gap-2 rounded-md bg-accent-soft p-3">
              <Ionicons name="sparkles-outline" size={15} colorClassName="accent-accent-deep" />
              <Text className="flex-1 type-caption text-ink-soft">{params.prompt}</Text>
            </View>
          ) : null}

          {recordings.length ? (
            <View className="gap-2">
              {recordings.map((asset, i) => (
                <AudioClip
                  key={asset.uri}
                  uri={asset.uri}
                  title={recordings.length > 1 ? `Recording ${i + 1}` : "Your recording"}
                  durationS={asset.durationS}
                />
              ))}
            </View>
          ) : null}
          {audioMode && !recordings.length ? (
            // Arrived without a clip (a deep link, or a reload that dropped the
            // in-memory draft): offer the recorder rather than an empty form.
            <View className="flex-row items-center gap-3 rounded-md border border-line bg-surface p-3 pl-4">
              <Text className="flex-1 type-body">No recording attached yet.</Text>
              <Button
                label="Record"
                icon="mic-outline"
                onPress={() =>
                  router.replace({
                    pathname: "/capture/record",
                    params: {
                      ...(params.prompt ? { prompt: params.prompt } : {}),
                      ...(params.collectionId ? { collectionId: params.collectionId } : {}),
                    },
                  })
                }
              />
            </View>
          ) : null}
          {missingVideo ? (
            <View className="flex-row items-center gap-3 rounded-md border border-line bg-surface p-3 pl-4">
              <Text className="flex-1 type-body">No video attached yet.</Text>
              <Button
                label="Record"
                icon="videocam-outline"
                onPress={() =>
                  router.replace({
                    pathname: "/capture/video",
                    params: {
                      ...(params.prompt ? { prompt: params.prompt } : {}),
                      ...(params.collectionId ? { collectionId: params.collectionId } : {}),
                    },
                  })
                }
              />
            </View>
          ) : null}

          {visuals.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {visuals.map((asset) =>
                  asset.mime.startsWith("video/") ? (
                    <VideoThumb key={asset.uri} asset={asset} />
                  ) : (
                    <Image
                      key={asset.uri}
                      source={{ uri: asset.uri }}
                      className="h-24 w-24 rounded-sm bg-surface-alt"
                      contentFit="cover"
                    />
                  ),
                )}
              </View>
            </ScrollView>
          ) : null}
          {audioMode || hasVideo ? (
            // Close under the media it's about, not a field's distance away.
            <Text className="-mt-4 type-caption">
              The transcript will be written automatically after you save.
            </Text>
          ) : null}
          {oversizedMessage ? <Text className="type-caption text-error">{oversizedMessage}</Text> : null}

          <Field label="Title">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="The morning we found out"
              placeholderTextColorClassName="accent-muted"
              className={`${INPUT} text-[15.5px]`}
            />
          </Field>

          <Field label="The story">
            <TextInput
              value={story}
              onChangeText={setStory}
              placeholder="What happened, and why it mattered…"
              placeholderTextColorClassName="accent-muted"
              multiline
              className={`${INPUT} min-h-[130px] font-sans text-[16px] leading-[24px]`}
              // Android only; no class sets it.
              style={{ textAlignVertical: "top" }}
            />
          </Field>

          <View className="flex-row gap-3">
            <Field label="Date" className="flex-1">
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColorClassName="accent-muted"
                className={`${INPUT} text-[15.5px]`}
              />
            </Field>
            <Field label="Place" className="flex-[1.4]">
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="Home"
                placeholderTextColorClassName="accent-muted"
                className={`${INPUT} text-[15.5px]`}
              />
            </Field>
          </View>

          <Field label="Who's in it">
            <View className="flex-row flex-wrap gap-2">
              {people.map((person) => (
                <Chip
                  key={person.id}
                  label={person.name}
                  selected={participantIds.includes(person.id)}
                  onPress={() => setParticipantIds((ids) => toggle(ids, person.id))}
                />
              ))}
            </View>
          </Field>

          <Field label="Saved by">
            <View className="flex-row flex-wrap gap-2">
              {people
                .filter((p) => p.role !== "CHILD")
                .map((person) => (
                  <Chip
                    key={person.id}
                    label={person.name}
                    selected={author === person.id}
                    onPress={() => setAuthorId(person.id)}
                  />
                ))}
            </View>
          </Field>

          <Field label="Where it belongs">
            <View className="mb-2 flex-row flex-wrap gap-2">
              {PILLARS.map((key) => (
                <Chip key={key} label={PILLAR_LABELS[key]} selected={pillar === key} onPress={() => setPillar(key)} />
              ))}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {collections.map((collection) => (
                <Chip
                  key={collection.id}
                  label={
                    collection.personName ? `${collection.personName} · ${collection.name}` : collection.name
                  }
                  selected={collectionIds.includes(collection.id)}
                  onPress={() => setCollectionIds((ids) => toggle(ids, collection.id))}
                />
              ))}
            </View>
            {chosen.length ? (
              <Text className="mt-2 type-caption">
                Filed in {chosen.map((c) => c.name).join(", ")}
              </Text>
            ) : null}
          </Field>

          {error ? <Text className="type-caption text-error">{error}</Text> : null}

          <Button
            label={saving ? (progress ?? "Preserving…") : "Preserve this memory"}
            icon="checkmark"
            onPress={save}
            disabled={saving || Boolean(oversizedMessage)}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * A video rides as a still frame with a badge, never through <Image> (which
 * can't decode a video). If the device can't show a frame, the badge alone
 * still says what's attached.
 */
function VideoThumb({ asset }: { asset: DraftAsset }) {
  const [failed, setFailed] = useState(false);
  return (
    <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-sm bg-surface-alt">
      <Ionicons name="videocam-outline" size={26} colorClassName="accent-muted" />
      {failed ? null : (
        <VideoClip
          uri={asset.uri}
          controls={false}
          muted
          contentFit="cover"
          onError={() => setFailed(true)}
          className="absolute inset-0"
        />
      )}
      <View className="absolute bottom-1.5 left-1.5 flex-row items-center gap-[3px] rounded-full bg-ink/55 px-1.5 py-0.5">
        <Ionicons name="play" size={10} colorClassName="accent-surface" />
        {asset.durationS ? (
          <Text className="text-[11px] font-semibold text-surface">{duration(asset.durationS)}</Text>
        ) : null}
      </View>
    </View>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={className}>
      <Text className="mb-2 type-label">{label}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-4 py-2 ${
        selected ? "border-accent-deep bg-accent-deep" : "border-line bg-surface"
      }`}
    >
      <Text className={`text-[13.5px] ${selected ? "text-surface" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
