import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiSend, mediaUrl, useApi, type MediaItem, type Memory } from "../../src/api";
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
import { duration, longDate } from "../../src/format";
import { colors, radius, spacing, type } from "../../src/theme";

/**
 * The immersive memory page: hero, the family's words, the original media, and
 * who was there. Everything stays editable — AI may draft, families decide.
 */
export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<{ memory: Memory }>(`/api/memories/${id}`);
  const [tab, setTab] = useState<"story" | "transcript">("story");
  const [editing, setEditing] = useState(false);
  const [storyDraft, setStoryDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharePressed, setSharePressed] = useState(false);

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const memory = data.memory;
  const photos = memory.media.filter((m) => m.type === "PHOTO" || m.type === "VIDEO");
  const audio = memory.media.filter((m) => m.type === "AUDIO");
  const hero = photos[0];

  async function saveStory() {
    setSaving(true);
    try {
      await apiSend(`/api/memories/${memory.id}`, "PATCH", { story: storyDraft });
      await refetch();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppHeader back subtitle={longDate(memory.occurredAt)} title={memory.title} globalActions={false} />
      <Screen padded={false}>
        <View style={styles.inner}>
          <View style={styles.heroWrap}>
            <Image
              source={{ uri: mediaUrl(hero?.url ?? memory.heroUrl) }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={280}
            />
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

          {memory.transcript ? (
            <View style={styles.toggle}>
              {(["story", "transcript"] as const).map((key) => (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={[styles.toggleItem, tab === key && styles.toggleItemActive]}
                >
                  <Text style={[styles.toggleLabel, tab === key && { color: colors.ink }]}>
                    {key === "story" ? "Story" : "Transcript"}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {tab === "story" ? (
            editing ? (
              <View style={{ marginTop: spacing.lg }}>
                <TextInput
                  value={storyDraft}
                  onChangeText={setStoryDraft}
                  multiline
                  style={styles.editor}
                  placeholder="What happened, and why it mattered…"
                  placeholderTextColor={colors.muted}
                />
                <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
                  <Button label={saving ? "Saving…" : "Save"} onPress={saveStory} disabled={saving} />
                  <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
                </View>
              </View>
            ) : (
              <Pressable
                onLongPress={() => {
                  setStoryDraft(memory.story ?? "");
                  setEditing(true);
                }}
              >
                <Text style={[type.story, { marginTop: spacing.lg }]}>
                  {memory.story ?? "No story written yet."}
                </Text>
              </Pressable>
            )
          ) : (
            <Text style={[type.body, styles.transcript]}>{memory.transcript}</Text>
          )}

          {!editing && tab === "story" ? (
            <Pressable
              onPress={() => {
                setStoryDraft(memory.story ?? "");
                setEditing(true);
              }}
              style={styles.editLink}
            >
              <Ionicons name="create-outline" size={15} color={colors.accentDeep} />
              <Text style={styles.editLinkText}>Edit this story</Text>
            </Pressable>
          ) : null}

          {audio.length ? (
            <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
              <Text style={type.label}>Recordings</Text>
              {audio.map((clip) => (
                <AudioCard key={clip.id} clip={clip} />
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

/** Playback needs real recordings first; the card shows what's stored today. */
function AudioCard({ clip }: { clip: MediaItem }) {
  return (
    <View style={styles.audio}>
      <View style={styles.audioPlay}>
        <Ionicons name="play" size={16} color={colors.surface} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, color: colors.ink }}>{clip.caption ?? "Voice recording"}</Text>
        <Text style={type.caption}>{duration(clip.durationS)} · playback coming with capture</Text>
      </View>
    </View>
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
  editLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  editLinkText: { fontSize: 13.5, color: colors.accentDeep, fontWeight: "600" },
  endMark: { alignItems: "center", marginTop: spacing.xxl, marginBottom: spacing.xl },
  audio: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  audioPlay: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDeep,
    alignItems: "center",
    justifyContent: "center",
  },
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
