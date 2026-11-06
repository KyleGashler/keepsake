import { useMutation } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
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
  uploadAssets,
  type Collection,
  type Memory,
  type PillarKey,
  type Person,
  tooLargeMessage,
  type UploadLimits,
} from "../../src/api";
import { AudioClip } from "../../src/components/audio";
import { VideoClip } from "../../src/components/video";
import { AppHeader, Button, ErrorState, Loading, Screen, ViewOnlyState } from "../../src/components/ui";
import { useCanContribute, useSession } from "../../src/auth/session-context";
import { draft, type DraftAsset } from "../../src/draft";
import { collectionName, duration, errorMessage } from "../../src/format";
import { pickLibraryMedia, takePhoto } from "../../src/pick-media";
import { composeParams, type ComposeParams } from "../../src/routes";
import { MEMORY_VIEWS, invalidate, useApiQuery } from "../../src/query";
import { Image, Ionicons, type IoniconName } from "../../src/styled";

const INPUT = "rounded-md border border-line bg-surface px-4 py-[13px] text-ink";

const PILLARS: PillarKey[] = ["ARRIVAL_STORIES", "CHILD_PROFILES", "FAMILY_LIFE"];

const PILLAR_LABELS: Record<PillarKey, string> = {
  ARRIVAL_STORIES: "Arrival",
  CHILD_PROFILES: "Children",
  FAMILY_LIFE: "Family Life",
};

// Local date, not UTC: an evening capture belongs to today, not tomorrow.
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toIso(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

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
  const params = useLocalSearchParams<ComposeParams>();
  const peopleQuery = useApiQuery<{ people: Person[] }>("/api/people");
  const collectionsQuery = useApiQuery<{ collections: Collection[] }>("/api/collections");
  const { data: limits } = useApiQuery<UploadLimits>("/api/media/limits", { staleTime: Infinity });
  const peopleData = peopleQuery.data;
  const collectionsData = collectionsQuery.data;
  const createMemory = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiSend<{ memory: Memory }>("/api/memories", "POST", body),
    onSuccess: () => invalidate(MEMORY_VIEWS),
  });
  const session = useSession();

  const [assets, setAssets] = useState<DraftAsset[]>([]);
  const addAssets = (added: DraftAsset[]) =>
    setAssets((current) => [...current, ...added.filter((a) => !current.some((c) => c.uri === a.uri))]);
  useFocusEffect(
    useCallback(() => {
      const arrived = draft.take();
      if (arrived.length) setAssets((current) => [...current, ...arrived]);
    }, []),
  );
  function removeAsset(uri: string) {
    setAssets((current) => current.filter((a) => a.uri !== uri));
    // A web recording's blob is otherwise held until the tab closes.
    if (Platform.OS === "web" && uri.startsWith("blob:")) URL.revokeObjectURL(uri);
  }
  const openRecorder = (pathname: "/capture/record" | "/capture/video") =>
    router.push({ pathname, params: composeParams(params) });
  const addMediaActions: { label: string; icon: IoniconName; onPress: () => void }[] = [
    { label: "Library", icon: "images-outline", onPress: async () => addAssets(await pickLibraryMedia()) },
    { label: "Photo", icon: "camera-outline", onPress: async () => addAssets(await takePhoto()) },
    { label: "Video", icon: "videocam-outline", onPress: () => openRecorder("/capture/video") },
    { label: "Voice", icon: "mic-outline", onPress: () => openRecorder("/capture/record") },
  ];
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [date, setDate] = useState(today());
  const [dateTouched, setDateTouched] = useState(false);
  const [location, setLocation] = useState("");
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    params.collectionId ? [params.collectionId] : [],
  );
  const [pillar, setPillar] = useState<PillarKey>("FAMILY_LIFE");
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Assets whose size the picker didn't report are caught by init's 413 instead.
  const oversized = limits ? assets.find((a) => a.bytes !== undefined && a.bytes > limits.maxUploadBytes) : undefined;
  const oversizedMessage = oversized && limits ? tooLargeMessage(oversized.mime, limits.maxUploadBytes) : null;

  const recordings = assets.filter((a) => a.mime.startsWith("audio/"));
  const visuals = assets.filter((a) => !a.mime.startsWith("audio/"));
  const hasVideo = visuals.some((a) => a.mime.startsWith("video/"));
  const hasPhoto = visuals.some((a) => !a.mime.startsWith("video/"));
  const photoDated = hasPhoto && !dateTouched;

  const people = peopleData?.people ?? [];
  const self = session.family?.personId;
  const author =
    authorId ??
    (self && people.some((p) => p.id === self) ? self : null) ??
    people.find((p) => p.role === "PARENT")?.id ??
    people[0]?.id ??
    null;

  const collections = useMemo(
    () =>
      (collectionsData?.collections ?? []).filter(
        (c) => c.pillar === pillar && (c.parentId === null || c.id === params.collectionId),
      ),
    [collectionsData, pillar, params.collectionId],
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
      const media = await uploadAssets(assets, setProgress);
      setProgress(assets.length ? "Preserving…" : null);

      const res = await createMemory.mutateAsync({
        title: title.trim(),
        story: story.trim() || undefined,
        occurredAt: photoDated ? undefined : toIso(date),
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

  if (!peopleData || !collectionsData) return <ComposeUnavailable queries={[peopleQuery, collectionsQuery]} />;

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

          <Field label="Photos, videos & voices">
            {visuals.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
                <View className="flex-row gap-2">
                  {visuals.map((asset) => {
                    const isVideo = asset.mime.startsWith("video/");
                    return (
                      <View key={asset.uri}>
                        {isVideo ? (
                          <VideoThumb asset={asset} />
                        ) : (
                          <Image
                            source={{ uri: asset.uri }}
                            className="h-24 w-24 rounded-sm bg-surface-alt"
                            contentFit="cover"
                          />
                        )}
                        <RemoveButton
                          label={isVideo ? "Remove video" : "Remove photo"}
                          onPress={() => removeAsset(asset.uri)}
                          className="absolute right-1 top-1 bg-ink/55"
                          iconClassName="accent-surface"
                        />
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            ) : null}
            {recordings.map((asset, i) => (
              <View key={asset.uri} className="mb-2 flex-row items-center gap-2">
                <View className="flex-1">
                  <AudioClip
                    uri={asset.uri}
                    title={recordings.length > 1 ? `Recording ${i + 1}` : "Your recording"}
                    durationS={asset.durationS}
                  />
                </View>
                <RemoveButton label="Remove recording" onPress={() => removeAsset(asset.uri)} iconClassName="accent-muted" />
              </View>
            ))}
            <View className="flex-row flex-wrap gap-2">
              {addMediaActions.map(({ label, icon, onPress }) => (
                <Button
                  key={label}
                  variant="secondary"
                  label={label}
                  icon={icon}
                  disabled={saving}
                  onPress={onPress}
                  className="grow basis-[140px] px-3"
                />
              ))}
            </View>
          </Field>
          {recordings.length || hasVideo ? (
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
                onChangeText={(next) => {
                  setDate(next);
                  setDateTouched(true);
                }}
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
          {photoDated ? (
            <Text className="-mt-4 type-caption">If the photo knows when it was taken, that date is used instead.</Text>
          ) : null}

          <Field label="Who's in it">
            {people.length === 0 ? (
              <Text className="type-caption">No one is in the archive yet. Add people from Home to say who was there.</Text>
            ) : null}
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
            {collections.length === 0 ? (
              <Text className="type-caption">
                {pillar === "FAMILY_LIFE"
                  ? "No Family Life collections yet. The memory is kept in the archive either way."
                  : "No collections here yet — they come with each child. The memory is kept in the archive either way."}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {collections.map((collection) => (
                <Chip
                  key={collection.id}
                  label={
                    collection.personName
                      ? `${collection.personName} · ${collectionName(collection)}`
                      : collectionName(collection)
                  }
                  selected={collectionIds.includes(collection.id)}
                  onPress={() => setCollectionIds((ids) => toggle(ids, collection.id))}
                />
              ))}
            </View>
            {chosen.length ? (
              <Text className="mt-2 type-caption">
                Filed in {chosen.map(collectionName).join(", ")}
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

function ComposeUnavailable({
  queries,
}: {
  queries: { error: Error | null; isFetching: boolean; refetch: () => Promise<unknown> }[];
}) {
  const failed = queries.find((q) => q.error)?.error;
  return (
    <>
      <AppHeader back subtitle="Capture" title="New memory" globalActions={false} />
      {failed ? (
        <ErrorState
          error={failed}
          onRetry={() => {
            for (const q of queries) if (q.error) void q.refetch();
          }}
          retrying={queries.some((q) => q.isFetching)}
        />
      ) : (
        <Loading label="Opening the archive…" />
      )}
    </>
  );
}

// <Image> can't decode a video, so show a frame through VideoClip behind a badge.
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

function RemoveButton({
  label,
  onPress,
  className = "",
  iconClassName,
}: {
  label: string;
  onPress: () => void;
  className?: string;
  iconClassName: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className={`h-7 w-7 items-center justify-center rounded-full active:opacity-70 ${className}`}
    >
      <Ionicons name="close" size={16} colorClassName={iconClassName} />
    </Pressable>
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
