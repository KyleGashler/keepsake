import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiSend, mediaUrl, useApi, type Memory, type TranscriptStatus, type UploadLimits } from "../../src/api";
import { AudioClip } from "../../src/components/audio";
import { VideoClip } from "../../src/components/video";
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
import { duration, errorMessage, lengthInWords, longDate } from "../../src/format";
import { openInLibrary, routes } from "../../src/routes";
import { colors, radius, spacing, type } from "../../src/theme";

/** How often to look again while a recording is being transcribed. */
const TRANSCRIPT_POLL_MS = 3000;

/**
 * The immersive memory page: hero, the family's words, the original media, and
 * who was there. Everything stays editable — AI may draft, families decide.
 */
export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<{ memory: Memory }>(`/api/memories/${id}`);
  // Only for the wording of a skipped long video ("over 2 minutes").
  const { data: limits } = useApi<UploadLimits>("/api/media/limits");
  const [chosenTab, setTab] = useState<"story" | "transcript" | null>(null);
  const [editing, setEditing] = useState<"story" | "transcript" | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sharePressed, setSharePressed] = useState(false);
  // Tapping something in "Original media" puts it in the hero slot.
  const [chosenMediaId, setChosenMediaId] = useState<string | null>(null);

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
  const hero = photos.find((m) => m.id === chosenMediaId) ?? photos[0];
  // Audio and video clips: anything that is being (or was) transcribed. A
  // skipped long video is neither, so it doesn't make a failure plural.
  const clips = memory.media.filter((m) => m.transcriptStatus !== null && m.transcriptStatus !== "SKIPPED");
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
      setSaveError(errorMessage(err));
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
              // Keyed by id: a new read URL on each poll must not rebuild the player.
              <VideoHero key={hero.id} url={mediaUrl(hero.url)} autoPlay={chosenMediaId === hero.id} />
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
          ) : null}
          {!editing && tab === "story" ? (
            <>
              <Pressable onLongPress={() => startEditing("story")}>
                <Text style={[type.story, { marginTop: spacing.lg }]}>
                  {memory.story ?? "No story written yet."}
                </Text>
              </Pressable>
              <EditLink label="Edit this story" onPress={() => startEditing("story")} />
            </>
          ) : null}
          {!editing && tab === "transcript" ? (
            <TranscriptPanel
              memory={memory}
              status={transcriptStatus}
              limits={limits}
              severalClips={clips.length > 1}
              retrying={retrying}
              onRetry={retryTranscripts}
              onEdit={() => startEditing("transcript")}
            />
          ) : null}

          {audio.length ? (
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <Text style={type.label}>Recordings</Text>
              {audio.map((clip) => (
                <AudioClip
                  key={clip.id}
                  uri={mediaUrl(clip.url)}
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
                  {photos.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setChosenMediaId(item.id)}
                      accessibilityRole="button"
                      accessibilityLabel={item.type === "VIDEO" ? "Play this video" : "Show this photo"}
                      accessibilityState={{ selected: item.id === hero?.id }}
                      style={[styles.thumb, item.id === hero?.id && styles.thumbChosen]}
                    >
                      {item.type === "VIDEO" ? (
                        // No poster frames yet (A6), and <Image> can't decode a video.
                        <View style={styles.videoThumb}>
                          <Ionicons name="play-circle-outline" size={34} color={colors.accentDeep} />
                          {item.durationS ? <Text style={type.caption}>{duration(item.durationS)}</Text> : null}
                        </View>
                      ) : (
                        <Image
                          source={{ uri: mediaUrl(item.url) }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          transition={200}
                        />
                      )}
                    </Pressable>
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
                    onPress={() => openInLibrary(routes.collection(collection.id))}
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
 * A video hero plays the original straight from storage — expo-video on a
 * phone, `<video>` on the web (see components/video). Nothing is transcoded
 * yet (docs/PLAN.md, "Decision: video, for now"), so an iPhone's HEVC clip
 * won't decode everywhere. When the player gives up — an error, or a picture
 * it can't decode — offer the original instead of a black box; the link hands
 * the file to the system player or the browser's download.
 */
/** The transcript side: where transcription stands, the words, and a way to edit them. */
function TranscriptPanel({
  memory,
  status,
  limits,
  severalClips,
  retrying,
  onRetry,
  onEdit,
}: {
  memory: Memory;
  status: TranscriptStatus | null;
  limits: UploadLimits | null;
  severalClips: boolean;
  retrying: boolean;
  onRetry: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      {status === "PENDING" ? (
        <View style={styles.transcriptState}>
          <ActivityIndicator color={colors.accentDeep} size="small" />
          <Text style={[type.caption, { flex: 1 }]}>
            {memory.transcript
              ? "Still transcribing a recording — this will update when it's done."
              : "Transcribing… the words will appear here in a moment."}
          </Text>
        </View>
      ) : null}
      {status === "SKIPPED" ? (
        // Every clip here is a long video. Nothing to retry: it's a
        // limit, not a failure. Writing one by hand is still offered below.
        <View style={styles.transcriptState}>
          <Ionicons name="time-outline" size={18} color={colors.accentDeep} />
          <Text style={[type.caption, { flex: 1 }]}>
            {limits
              ? `Transcripts for videos over ${lengthInWords(limits.transcribeMaxVideoSeconds)} are coming.`
              : "Transcripts for long videos are coming."}{" "}
            The video itself is kept in full.
          </Text>
        </View>
      ) : null}
      {status === "FAILED" ? (
        <View style={styles.transcriptState}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.accentDeep} />
          <Text style={[type.caption, { flex: 1 }]}>
            We couldn't write the transcript for {severalClips ? "a recording" : "this recording"}.
          </Text>
          <Button
            label={retrying ? "Trying…" : "Try again"}
            variant="secondary"
            onPress={onRetry}
            disabled={retrying}
          />
        </View>
      ) : null}
      {memory.transcript ? (
        <Pressable onLongPress={onEdit}>
          <Text style={[type.body, styles.transcript]}>{memory.transcript}</Text>
        </Pressable>
      ) : null}
      {/* Typing one in by hand is always allowed; the pipeline never overwrites it. */}
      {memory.transcript || status !== "PENDING" ? (
        <EditLink
          label={memory.transcript ? "Edit transcript" : "Write the transcript yourself"}
          onPress={onEdit}
        />
      ) : null}
    </>
  );
}

function VideoHero({ url, autoPlay }: { url: string; autoPlay: boolean }) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return (
      <VideoClip
        uri={url}
        autoPlay={autoPlay}
        onError={() => setFailed(true)}
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]}
      />
    );
  }

  return (
    <View style={styles.videoFallback}>
      <Ionicons name="videocam-outline" size={30} color={colors.muted} />
      <Text style={[type.caption, { textAlign: "center" }]}>This video can't play here.</Text>
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
  thumb: {
    width: 132,
    height: 132,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
  },
  thumbChosen: { borderColor: colors.accent },
  videoThumb: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
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
