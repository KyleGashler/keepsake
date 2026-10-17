import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { createElement, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiSend, mediaUrl, useApi, type Memory } from "../../src/api";
import { AudioClip } from "../../src/components/audio";
import { LittleMoon } from "../../src/components/brand";
import {
  AppHeader,
  Avatar,
  Button,
  ErrorState,
  Loading,
  PreviewNote,
  Screen,
} from "../../src/components/ui";
import { longDate } from "../../src/format";

/** How often to look again while a recording is being transcribed. */
const TRANSCRIPT_POLL_MS = 3000;
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * The immersive memory page: hero, the family's words, the original media, and
 * who was there. Everything stays editable — AI may draft, families decide.
 */
export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<{ memory: Memory }>(`/api/memories/${id}`);
  const [chosenTab, setTab] = useState<"story" | "transcript" | null>(null);
  const [editing, setEditing] = useState<"story" | "transcript" | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sharePressed, setSharePressed] = useState(false);

  // The transcript is written in the background after upload; keep looking
  // until it settles so it appears without a refresh.
  const transcriptStatus = data?.memory.transcriptStatus ?? null;
  useEffect(() => {
    if (transcriptStatus !== "PENDING") return;
    const timer = setInterval(() => void refetch(), TRANSCRIPT_POLL_MS);
    return () => clearInterval(timer);
  }, [transcriptStatus, refetch]);

  // A failed poll shouldn't blank a page that's already showing the memory.
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const memory = data.memory;
  const photos = memory.media.filter((m) => m.type === "PHOTO" || m.type === "VIDEO");
  const audio = memory.media.filter((m) => m.type === "AUDIO");
  const hero = photos[0];
  const hasTranscript = Boolean(memory.transcript) || transcriptStatus !== null;
  // A fresh recording has no story yet — open on the transcript it's waiting for.
  const tab = !hasTranscript ? "story" : (chosenTab ?? (memory.story ? "story" : "transcript"));

  function startEditing(field: "story" | "transcript") {
    setTextDraft((field === "story" ? memory.story : memory.transcript) ?? "");
    setSaveError(null);
    setEditing(field);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiSend(`/api/memories/${memory.id}`, "PATCH", { [editing]: textDraft });
      await refetch();
      setEditing(null);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function retryTranscripts() {
    setRetrying(true);
    try {
      const failed = memory.media.filter((m) => m.transcriptStatus === "FAILED");
      await Promise.all(
        failed.map((m) => apiSend(`/api/memories/${memory.id}/media/${m.id}/transcribe`, "POST", {})),
      );
    } catch {
      // Whatever didn't re-queue still shows as failed after the refetch.
    } finally {
      await refetch();
      setRetrying(false);
    }
  }

  return (
    <>
      <AppHeader back subtitle={longDate(memory.occurredAt)} title={memory.title} globalActions={false} />
      <Screen padded={false}>
        <View style={styles.inner}>
          <View style={styles.heroWrap}>
            {hero?.type === "VIDEO" ? (
              <VideoHero url={mediaUrl(hero.url) as string} />
            ) : (
              <Image
                source={{ uri: mediaUrl(hero?.url ?? memory.heroUrl) }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={280}
              />
            )}
          </View>

          <View style={styles.metaRow}>
            {memory.author ? (
              <View style={styles.author}>
                <Avatar person={memory.author} size={30} />
                <Text style={type.caption}>Preserved by {memory.author.name}</Text>
              </View>
            ) : null}
            {memory.location ? (
              <View style={styles.author}>
                <Ionicons name="location-outline" size={14} color={colors.muted} />
                <Text style={type.caption}>{memory.location}</Text>
              </View>
            ) : null}
          </View>

          {hasTranscript ? (
            <View style={styles.toggle}>
              {(["story", "transcript"] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => {
                    setTab(key);
                    setEditing(null);
                  }}
                  style={[styles.toggleItem, tab === key && styles.toggleItemActive]}
                >
                  <Text style={[styles.toggleLabel, tab === key && { color: colors.ink }]}>
                    {key === "story" ? "Story" : "Transcript"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {editing ? (
            <View style={{ marginTop: spacing.lg }}>
              <TextInput
                value={textDraft}
                onChangeText={setTextDraft}
                multiline
                autoFocus
                style={[styles.editor, editing === "transcript" && styles.editorTranscript]}
                placeholder={
                  editing === "story" ? "What happened, and why it mattered…" : "What was said, in your words…"
                }
                placeholderTextColor={colors.muted}
              />
              {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
              <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
                <Button label={saving ? "Saving…" : "Save"} onPress={saveEdit} disabled={saving} />
                <Button label="Cancel" variant="secondary" onPress={() => setEditing(null)} />
              </View>
            </View>
          ) : tab === "story" ? (
            <>
              <Pressable onLongPress={() => startEditing("story")}>
                <Text style={[type.story, { marginTop: spacing.lg }]}>
                  {memory.story ?? "No story written yet."}
                </Text>
              </Pressable>
              <EditLink label="Edit this story" onPress={() => startEditing("story")} />
            </>
          ) : (
            <>
              {transcriptStatus === "PENDING" ? (
                <View style={styles.transcriptState}>
                  <ActivityIndicator color={colors.accentDeep} size="small" />
                  <Text style={[type.caption, { flex: 1 }]}>
                    {memory.transcript
                      ? "Still transcribing a recording — this will update when it's done."
                      : "Transcribing… the words will appear here in a moment."}
                  </Text>
                </View>
              ) : null}
              {transcriptStatus === "FAILED" ? (
                <View style={styles.transcriptState}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.accentDeep} />
                  <Text style={[type.caption, { flex: 1 }]}>
                    We couldn't write the transcript for {audio.length > 1 ? "a recording" : "this recording"}.
                  </Text>
                  <Button
                    label={retrying ? "Trying…" : "Try again"}
                    variant="secondary"
                    onPress={retryTranscripts}
                    disabled={retrying}
                  />
                </View>
              ) : null}
              {memory.transcript ? (
                <Pressable onLongPress={() => startEditing("transcript")}>
                  <Text style={[type.body, styles.transcript]}>{memory.transcript}</Text>
                </Pressable>
              ) : null}
              {/* Typing one in by hand is always allowed; the pipeline never overwrites it. */}
              {memory.transcript || transcriptStatus !== "PENDING" ? (
                <EditLink
                  label={memory.transcript ? "Edit transcript" : "Write the transcript yourself"}
                  onPress={() => startEditing("transcript")}
                />
              ) : null}
            </>
          )}

          {audio.length ? (
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <Text style={type.label}>Recordings</Text>
              {audio.map((clip) => (
                <AudioClip
                  key={clip.id}
                  uri={mediaUrl(clip.url) as string}
                  title={clip.caption ?? "Voice recording"}
                  durationS={clip.durationS}
                />
              ))}
            </View>
          ) : null}

          {photos.length > 1 ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[type.label, { marginBottom: spacing.md }]}>Original media</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {photos.map((photo) => (
                    <Image
                      key={photo.id}
                      source={{ uri: mediaUrl(photo.url) }}
                      style={styles.thumb}
                      contentFit="cover"
                      transition={200}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {memory.participants.length ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[type.label, { marginBottom: spacing.md }]}>Who was there</Text>
              <View style={styles.people}>
                {memory.participants.map((person) => (
                  <Pressable
                    key={person.id}
                    onPress={() => router.push(`/person/${person.id}`)}
                    style={styles.personRow}
                  >
                    <Avatar person={person} size={34} />
                    <Text style={{ fontSize: 14, color: colors.ink }}>{person.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {memory.collections.length ? (
            <View style={{ marginTop: spacing.xl }}>
              <Text style={[type.label, { marginBottom: spacing.md }]}>Filed in</Text>
              <View style={styles.chipWrap}>
                {memory.collections.map((collection) => (
                  <Pressable
                    key={collection.id}
                    onPress={() => router.push(`/collection/${collection.id}`)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipLabel}>{collection.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Whimsical shape 5/6 — little moon, the end-mark on a memory that's told. */}
          <View style={styles.endMark}>
            <LittleMoon size={18} opacity={0.75} />
          </View>

          <Button
            label="Share this memory"
            variant="secondary"
            icon="share-outline"
            onPress={() => setSharePressed(true)}
            style={{ alignSelf: "center" }}
          />
          {sharePressed ? (
            <PreviewNote>
              Private web links, printable stories, and highlight reels come after accounts land — sharing has
              to respect permissions before it can leave the archive.
            </PreviewNote>
          ) : null}
        </View>
      </Screen>
    </>
  );
}

/**
 * A video hero plays the original straight from storage. Nothing is transcoded
 * yet (docs/PLAN.md, "Decision: video, for now"), so an iPhone's HEVC clip
 * won't decode in every browser. When the player gives up — an error, or
 * metadata with no picture — offer the original instead of a black box. Native
 * has no in-app player yet and goes straight to the link, which hands the file
 * to the system player.
 */
function VideoHero({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  if (Platform.OS === "web" && !failed) {
    return createElement("video", {
      src: url,
      controls: true,
      playsInline: true,
      preload: "metadata",
      onError: () => setFailed(true),
      onLoadedMetadata: (e: { currentTarget: { videoWidth: number } }) => {
        if (e.currentTarget.videoWidth === 0) setFailed(true);
      },
      style: { width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" },
    });
  }

  return (
    <View style={styles.videoFallback}>
      <Ionicons name="videocam-outline" size={30} color={colors.muted} />
      <Text style={[type.caption, { textAlign: "center" }]}>
        {failed ? "This video can't play here." : "Video"}
      </Text>
      <Pressable onPress={() => Linking.openURL(url)} style={styles.editLink}>
        <Ionicons name="open-outline" size={15} color={colors.accentDeep} />
        <Text style={styles.editLinkText}>Open original</Text>
      </Pressable>
    </View>
  );
}

function EditLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.editLink}>
      <Ionicons name="create-outline" size={15} color={colors.accentDeep} />
      <Text style={styles.editLinkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: { paddingHorizontal: spacing.lg },
  heroWrap: {
    height: 320,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.sm,
  },
  videoFallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.lg },
  author: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.xl,
    alignSelf: "flex-start",
  },
  toggleItem: { paddingVertical: 7, paddingHorizontal: spacing.xl, borderRadius: radius.pill },
  toggleItemActive: { backgroundColor: colors.surface },
  toggleLabel: { fontSize: 13.5, color: colors.muted, fontWeight: "600" },
  transcript: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    fontSize: 14.5,
    lineHeight: 25,
  },
  editor: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 180,
    textAlignVertical: "top",
    fontFamily: type.story.fontFamily,
    fontSize: 16.5,
    lineHeight: 28,
    color: colors.ink,
  },
  editorTranscript: { fontFamily: undefined, fontSize: 14.5, lineHeight: 25 },
  transcriptState: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  error: { ...type.caption, color: "#9C4A38", marginTop: spacing.sm },
  editLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  editLinkText: { fontSize: 13.5, color: colors.accentDeep, fontWeight: "600" },
  endMark: { alignItems: "center", marginTop: spacing.xxl, marginBottom: spacing.xl },
  thumb: { width: 132, height: 132, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  people: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  personRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipLabel: { fontSize: 13, color: colors.ink },
});
