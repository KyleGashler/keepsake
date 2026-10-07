import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { AppHeader, Button, Loading, PreviewNote, Screen } from "../../src/components/ui";
import { draft } from "../../src/draft";
import { colors, radius, spacing, type } from "../../src/theme";

const PILLAR_LABELS: Record<PillarKey, string> = {
  ARRIVAL_STORIES: "Arrival",
  CHILD_PROFILES: "Children",
  FAMILY_LIFE: "Family Life",
};

/** Local date, not UTC — an evening capture belongs to today, not tomorrow. */
function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Accepts YYYY-MM-DD; falls back to now so a typo can't lose the memory. */
function toIso(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export default function ComposeScreen() {
  const params = useLocalSearchParams<{ prompt?: string; collectionId?: string; mode?: string }>();
  const { data: peopleData } = useApi<{ people: Person[] }>("/api/people");
  const { data: collectionsData } = useApi<{ collections: Collection[] }>("/api/collections");
  const { data: limits } = useApi<UploadLimits>("/api/media/limits");

  // Media picked in Capture is handed over once, on mount.
  const [assets] = useState(() => draft.take());
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [transcript, setTranscript] = useState("");
  const [date, setDate] = useState(today());
  const [location, setLocation] = useState("");
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>(
    params.collectionId ? [String(params.collectionId)] : [],
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

  const people = peopleData?.people ?? [];
  const author = authorId ?? people.find((p) => p.role === "PARENT")?.id ?? people[0]?.id ?? null;

  const collections = useMemo(
    () => (collectionsData?.collections ?? []).filter((c) => c.pillar === pillar),
    [collectionsData, pillar],
  );
  const chosen = useMemo(
    () => (collectionsData?.collections ?? []).filter((c) => collectionIds.includes(c.id)),
    [collectionsData, collectionIds],
  );

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function save() {
    if (!title.trim()) return setError("Give the memory a title so it can be found again.");
    setSaving(true);
    setError(null);
    try {
      const media = [];
      for (const [i, asset] of assets.entries()) {
        const label = assets.length > 1 ? `${i + 1} of ${assets.length}` : "";
        setProgress(`Uploading ${label}`.trim() + "…");
        const uploaded = await uploadFile(asset.uri, asset.name, asset.mime, (fraction) =>
          setProgress(`Uploading ${label} ${Math.round(fraction * 100)}%`.replace(/\s+/g, " ").trim()),
        );
        // Everything but the caption comes from the server's own reading of the
        // bytes; the picker's dimensions only fill in what it couldn't measure.
        media.push({
          type: uploaded.type,
          storageKey: uploaded.key,
          mimeType: uploaded.mimeType,
          bytes: uploaded.bytes,
          sha256: uploaded.sha256,
          width: uploaded.width ?? asset.width ?? 1200,
          height: uploaded.height ?? asset.height ?? 900,
        });
      }
      setProgress(assets.length ? "Preserving…" : null);

      const res = await apiSend<{ memory: Memory }>("/api/memories", "POST", {
        title: title.trim(),
        story: story.trim() || undefined,
        transcript: transcript.trim() || undefined,
        occurredAt: toIso(date),
        location: location.trim() || undefined,
        authorId: author ?? undefined,
        participantIds,
        collectionIds,
        media,
      });

      router.replace(`/memory/${res.memory.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  if (!peopleData || !collectionsData) return <Loading label="Opening the archive…" />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader back subtitle="Capture" title="New memory" globalActions={false} />
      <Screen>
        {params.prompt ? (
          <View style={styles.promptEcho}>
            <Ionicons name="sparkles-outline" size={15} color={colors.accentDeep} />
            <Text style={[type.caption, { flex: 1, color: colors.inkSoft }]}>{params.prompt}</Text>
          </View>
        ) : null}

        {assets.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {assets.map((asset) => (
                <Image key={asset.uri} source={{ uri: asset.uri }} style={styles.thumb} contentFit="cover" />
              ))}
            </View>
          </ScrollView>
        ) : null}
        {oversizedMessage ? <Text style={styles.error}>{oversizedMessage}</Text> : null}

        <Field label="Title">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="The morning we found out"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </Field>

        {params.mode === "audio" ? (
          <>
            <Field label="Transcript">
              <TextInput
                value={transcript}
                onChangeText={setTranscript}
                placeholder={"Mae: The moon is following our car.\nAli: It does look like that, doesn't it?"}
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, styles.multiline]}
              />
            </Field>
            <PreviewNote>
              Recording and automatic transcription arrive with the AI phase. Typed transcripts are stored in
              the same field, so nothing has to be migrated later.
            </PreviewNote>
          </>
        ) : null}

        <Field label="The story">
          <TextInput
            value={story}
            onChangeText={setStory}
            placeholder="What happened, and why it mattered…"
            placeholderTextColor={colors.muted}
            multiline
            style={[styles.input, styles.multiline, { fontFamily: type.story.fontFamily, fontSize: 16 }]}
          />
        </Field>

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Field label="Date" style={{ flex: 1 }}>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </Field>
          <Field label="Place" style={{ flex: 1.4 }}>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Home"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </Field>
        </View>

        <Field label="Who's in it">
          <View style={styles.chipWrap}>
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
          <View style={styles.chipWrap}>
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
          <View style={[styles.chipWrap, { marginBottom: spacing.sm }]}>
            {(Object.keys(PILLAR_LABELS) as PillarKey[]).map((key) => (
              <Chip key={key} label={PILLAR_LABELS[key]} selected={pillar === key} onPress={() => setPillar(key)} />
            ))}
          </View>
          <View style={styles.chipWrap}>
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
            <Text style={[type.caption, { marginTop: spacing.sm }]}>
              Filed in {chosen.map((c) => c.name).join(", ")}
            </Text>
          ) : null}
        </Field>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={saving ? (progress ?? "Preserving…") : "Preserve this memory"}
          icon="checkmark"
          onPress={save}
          disabled={saving || Boolean(oversizedMessage)}
          style={{ marginTop: spacing.xl }}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: object;
}) {
  return (
    <View style={[{ marginTop: spacing.xl }, style]}>
      <Text style={[type.label, { marginBottom: spacing.sm }]}>{label}</Text>
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
      style={[styles.chip, selected && { backgroundColor: colors.accentDeep, borderColor: colors.accentDeep }]}
    >
      <Text style={[styles.chipLabel, selected && { color: colors.surface }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  promptEcho: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    fontSize: 15.5,
    color: colors.ink,
  },
  multiline: { minHeight: 130, textAlignVertical: "top", lineHeight: 24 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipLabel: { fontSize: 13.5, color: colors.ink },
  error: { ...type.caption, color: "#9C4A38", marginTop: spacing.lg },
});
