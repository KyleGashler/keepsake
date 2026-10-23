import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  apiSend,
  isNotFound,
  mediaStatus,
  mediaUrl,
  useApi,
  type MediaItem,
  type Memory,
  type MemoryCollection,
  type Person,
  type TranscriptStatus,
} from "../../src/api";
import { MediaGallery } from "../../src/components/memory/gallery";
import { HeroVideo } from "../../src/components/memory/hero-video";
import {
  AvatarStack,
  DetailRow,
  DetailValue,
  RelatedRow,
  Section,
  StoryText,
  WordsToggle,
  type WordsView,
} from "../../src/components/memory/parts";
import { DANGER } from "../../src/components/memory/helpers";
import { MemorySheets, type SheetKind } from "../../src/components/memory/sheets";
import { MediaViewer } from "../../src/components/memory/viewer";
import { WaveformPlayer } from "../../src/components/memory/waveform";
import { Button, ErrorState, Loading, NotFoundState } from "../../src/components/ui";
import { useCanContribute } from "../../src/auth/session-context";
import { errorMessage, seasonOf, shortDate } from "../../src/format";
import { goBackOr, openInLibrary, routes } from "../../src/routes";
import { brand, colors, fonts, MAX_WIDTH, radius, shadow, spacing, type } from "../../src/theme";

/** How often to look again while a clip is being prepared or transcribed. */
const POLL_MS = 3000;
/** How far the content card rides up over the hero. */
const CARD_OVERLAP = 24;

/**
 * One memory, immersive: the photo or video full-bleed at the top, then a
 * card with the family's words (Story, or the Original Words that were
 * recorded), who was there, every photo and video, the recordings, where and
 * when, and memories like it. Every section is there only when it has
 * something to show, so a memory of words alone is a whole page — not a
 * photo memory with holes. Everything stays editable: AI may draft, families
 * decide.
 */
export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refetch } = useApi<{ memory: Memory }>(`/api/memories/${id}`);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [chosenView, setView] = useState<WordsView | null>(null);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  // Bumped by "Try again" so the hero builds a new player on a fresh URL.
  const [videoAttempt, setVideoAttempt] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  // Optimistic: the heart fills on tap, and goes back if the server says no.
  const [favorite, setFavorite] = useState<boolean | null>(null);
  // A VIEWER reads (and keeps favourites, which are their own); every way
  // into editing the memory is left out for them.
  const canContribute = useCanContribute();

  // Coming back from a related memory (or one deleted from there) shows
  // what's true now. The hero pauses while you're away.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void refetch();
      return () => setFocused(false);
    }, [refetch]),
  );

  // Mux prepares each clip, and then its transcript, in the background after
  // upload; keep looking until both settle so the player and the words appear
  // without a refresh.
  const transcriptStatus = data?.memory.transcriptStatus ?? null;
  const preparing = data?.memory.media.some((m) => mediaStatus(m) === "PROCESSING") ?? false;
  const settling = transcriptStatus === "PENDING" || preparing;
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(timer);
  }, [settling, refetch]);

  // Deleted (here, or by someone else while this was open), from another
  // family, or a stale link. Checked before `data` so a refresh that finds it
  // gone doesn't leave the old memory up.
  if (isNotFound(error)) {
    return (
      <View style={[styles.goneScreen, { paddingTop: insets.top }]}>
        <NotFoundState
          title="This memory isn't here anymore"
          backLabel="Go back"
          onBack={() => goBackOr("/")}
        />
      </View>
    );
  }
  // A failed poll shouldn't blank a page that's already showing the memory.
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const memory = data.memory;
  const visuals = memory.media.filter((m) => m.type === "PHOTO" || m.type === "VIDEO");
  const recordings = memory.media.filter((m) => m.type === "AUDIO");
  const hero = visuals[0];
  // Audio and video clips: anything that is being (or was) transcribed.
  const clips = memory.media.filter((m) => m.transcriptStatus !== null);

  const hasStory = Boolean(memory.story?.trim());
  const hasWords = Boolean(memory.transcript) || transcriptStatus !== null;
  const view = wordsView(hasStory, hasWords, chosenView);
  const isFavorite = favorite ?? memory.isFavorite;
  const pageWidth = Math.min(windowWidth, MAX_WIDTH);
  const heroHeight = Math.round(Math.min(pageWidth * 0.86, 440));

  async function toggleFavorite() {
    const next = !isFavorite;
    setFavorite(next);
    try {
      await apiSend(`/api/memories/${memory.id}/favorite`, next ? "PUT" : "DELETE");
    } catch {
      setFavorite(!next);
    }
  }

  function startTranscriptEdit() {
    setTranscriptDraft(memory.transcript ?? "");
    setSaveError(null);
    setEditingTranscript(true);
  }

  async function saveTranscript() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiSend(`/api/memories/${memory.id}`, "PATCH", { transcript: transcriptDraft });
      await refetch();
      setEditingTranscript(false);
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

  const can = editHandlers(canContribute, {
    more: () => setSheet("options"),
    edit: () => setSheet("edit"),
    retry: retryTranscripts,
    editTranscript: startTranscriptEdit,
  });

  const actions = (
    <TopActions
      floating={Boolean(hero)}
      favorite={isFavorite}
      onBack={back}
      onFavorite={toggleFavorite}
      onMore={can.more}
    />
  );

  const players = recordings.map((clip, i) => {
    const status = mediaStatus(clip);
    if (status === "READY" && clip.url) {
      return (
        <WaveformPlayer
          key={clip.id}
          id={clip.id}
          uri={mediaUrl(clip.url)}
          durationS={clip.durationS}
          label={clip.caption ?? (recordings.length > 1 ? `Recording ${i + 1}` : "Voice recording")}
        />
      );
    }
    return (
      <View key={clip.id} style={styles.transcriptState}>
        {status === "FAILED" ? (
          <Ionicons name="alert-circle-outline" size={18} color={colors.accentDeep} />
        ) : (
          <ActivityIndicator color={colors.accentDeep} size="small" />
        )}
        <Text style={[type.caption, { flex: 1 }]}>
          {status === "FAILED" ? "This recording couldn't be prepared to play." : "Preparing audio…"}
        </Text>
      </View>
    );
  });

  return (
    <View style={styles.screen}>
      {hero ? null : <View style={{ paddingTop: insets.top }}>{actions}</View>}
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={
          hero
            ? (e) => setPastHero(e.nativeEvent.contentOffset.y > heroHeight - insets.top - DISC - spacing.lg)
            : undefined
        }
      >
        <View style={[styles.column, { flexGrow: 1 }]}>
          {hero ? (
            <View style={[styles.hero, { height: heroHeight + CARD_OVERLAP }]}>
              <HeroMedia
                hero={hero}
                paused={!focused || viewerAt !== null}
                videoFailed={videoFailed}
                videoAttempt={videoAttempt}
                onVideoError={() => setVideoFailed(true)}
                onVideoRetry={() => {
                  // A fresh signed URL (the old token may have lapsed), then a new player.
                  void refetch().then(() => {
                    setVideoFailed(false);
                    setVideoAttempt((n) => n + 1);
                  });
                }}
                onOpen={() => setViewerAt(0)}
              />
            </View>
          ) : null}

          <View
            style={[
              styles.card,
              hero ? { marginTop: -CARD_OVERLAP } : styles.cardAlone,
              { paddingBottom: insets.bottom + spacing.xxl },
            ]}
          >
            {view && hasStory && hasWords ? (
              <View style={{ marginBottom: spacing.lg }}>
                <WordsToggle
                  value={view}
                  onChange={(next) => {
                    setView(next);
                    setEditingTranscript(false);
                  }}
                />
              </View>
            ) : null}

            <Text style={styles.date}>{shortDate(memory.occurredAt)}</Text>
            <View style={styles.titleRow}>
              <Text style={[styles.title, !hero && styles.titleLarge]} accessibilityRole="header">
                {memory.title}
              </Text>
              {can.edit ? (
                <Pressable
                  onPress={() => setSheet("edit")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Edit memory"
                  style={({ pressed }) => [styles.pencil, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="pencil-outline" size={20} color={colors.inkSoft} />
                </Pressable>
              ) : null}
            </View>

            {view === "story" && memory.story ? (
              <Pressable
                onLongPress={can.edit}
                style={{ marginTop: spacing.sm }}
              >
                <StoryText story={memory.story} textOnly={memory.isTextOnly} />
              </Pressable>
            ) : null}
            {view === "transcript" ? (
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                {players}
                {editingTranscript ? (
                  <TranscriptEditor
                    value={transcriptDraft}
                    onChange={setTranscriptDraft}
                    saving={saving}
                    error={saveError}
                    onSave={saveTranscript}
                    onCancel={() => setEditingTranscript(false)}
                  />
                ) : (
                  <TranscriptPanel
                    memory={memory}
                    status={transcriptStatus}
                    severalClips={clips.length > 1}
                    retrying={retrying}
                    onRetry={can.retry}
                    onEdit={can.editTranscript}
                  />
                )}
              </View>
            ) : null}
            {view === null && can.edit ? (
              <Pressable onPress={() => setSheet("edit")} style={styles.editLink} accessibilityRole="button">
                <Ionicons name="create-outline" size={15} color={colors.accentDeep} />
                <Text style={styles.editLinkText}>Write the story of this memory</Text>
              </Pressable>
            ) : null}

            {memory.participants.length ? (
              <View style={{ marginTop: spacing.lg }}>
                <AvatarStack people={memory.participants} />
              </View>
            ) : null}

            {/* The hero already shows a lone photo or video; the gallery is for more than one. */}
            {visuals.length > 1 ? (
              <Section title="Media">
                <MediaGallery items={visuals} onOpen={setViewerAt} />
              </Section>
            ) : null}

            {/* Original Words carries its own players at the top. */}
            {recordings.length && view !== "transcript" ? (
              <Section title="Audio">
                <View style={{ gap: spacing.md }}>{players}</View>
              </Section>
            ) : null}

            <MemoryDetails memory={memory} />

            {memory.related.length ? (
              <Section title="Related Memories">
                <RelatedRow memories={memory.related} />
              </Section>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {hero ? (
        // Once the hero has scrolled away, a white strip settles in behind
        // the buttons so they don't sit on top of the words.
        <View
          style={[styles.floating, { paddingTop: insets.top + spacing.sm }, pastHero && styles.floatingSettled]}
        >
          {actions}
        </View>
      ) : null}

      <MediaViewer items={visuals} index={viewerAt} onClose={() => setViewerAt(null)} />
      <MemorySheets
        memory={memory}
        kind={sheet}
        onKind={setSheet}
        onChanged={refetch}
        onDeleted={() => {
          setSheet(null);
          back();
        }}
      />
    </View>
  );
}

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/**
 * Which words show: the toggle's choice when there are both, else whichever
 * exists, else none. With both, Story leads.
 */
function wordsView(hasStory: boolean, hasWords: boolean, chosen: WordsView | null): WordsView | null {
  if (hasStory && hasWords) return chosen ?? "story";
  if (hasStory) return "story";
  // A fresh recording has no story yet — open on the transcript it's waiting for.
  if (hasWords) return "transcript";
  return null;
}

/**
 * The photo, or the video with its own controls — "Preparing video…" while
 * Mux is still at it, and a plain word if it failed or won't play.
 */
function HeroMedia({
  hero,
  paused,
  videoFailed,
  videoAttempt,
  onVideoError,
  onVideoRetry,
  onOpen,
}: {
  hero: MediaItem;
  /** The viewer is open or the page is covered: the video stops. */
  paused: boolean;
  videoFailed: boolean;
  videoAttempt: number;
  onVideoError: () => void;
  onVideoRetry: () => void;
  onOpen: () => void;
}) {
  if (hero.type === "VIDEO") {
    const status = mediaStatus(hero);
    if (status === "PROCESSING") return <VideoPreparing />;
    if (status === "FAILED" || !hero.url) return <VideoFallback />;
    if (videoFailed) return <VideoFallback onRetry={onVideoRetry} />;
    return (
      <HeroVideo
        // Keyed by id: a new signed URL on each poll must not rebuild the
        // player. "Try again" bumps the attempt to build a new one on purpose.
        key={`${hero.id}:${videoAttempt}`}
        uri={mediaUrl(hero.url)}
        posterUrl={hero.posterUrl}
        durationS={hero.durationS}
        paused={paused}
        onError={onVideoError}
      />
    );
  }
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="imagebutton"
      accessibilityLabel="Open photo full screen"
      style={StyleSheet.absoluteFill}
    >
      <Image
        source={{ uri: mediaUrl(hero.url) }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={280}
        recyclingKey={hero.id}
      />
    </Pressable>
  );
}

/**
 * Back on the left; favourite and ⋯ on the right. Over a hero they float as
 * white discs and stay put while the page scrolls under them; without one
 * they're an ordinary bar on paper.
 */
type EditHandlers = {
  more?: () => void;
  edit?: () => void;
  retry?: () => void;
  editTranscript?: () => void;
};

/** Every way into changing the memory — or none, for someone who can only view. */
function editHandlers(canContribute: boolean, handlers: Required<EditHandlers>): EditHandlers {
  return canContribute ? handlers : {};
}

function TopActions({
  floating,
  favorite,
  onBack,
  onFavorite,
  onMore,
}: {
  floating: boolean;
  favorite: boolean;
  onBack: () => void;
  onFavorite: () => void;
  /** Absent for a VIEWER: every option in that menu changes the memory. */
  onMore?: () => void;
}) {
  const disc = [styles.disc, floating ? styles.discFloating : styles.discFlat];
  return (
    <View style={[styles.actions, !floating && styles.actionsBar]}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={disc}>
        <Ionicons name="chevron-back" size={22} color={colors.ink} style={{ marginLeft: -2 }} />
      </Pressable>
      <View style={styles.actionsRight}>
        <Pressable
          onPress={onFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favorite ? "Remove from favourites" : "Favourite this memory"}
          accessibilityState={{ selected: favorite }}
          style={disc}
        >
          <Ionicons
            name={favorite ? "heart" : "heart-outline"}
            size={21}
            color={favorite ? brand.terracotta : colors.ink}
          />
        </Pressable>
        {onMore ? (
          <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel="More options" style={disc}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Happened in · Where · Collection — each only when it has a value. */
function MemoryDetails({ memory }: { memory: Memory }) {
  const collections = memory.collections;
  // Filed under two children ("Day-to-Day Moments" twice)? Say whose is whose.
  const names = collections.map((c) => c.name);
  const ambiguous = names.some((n, i) => names.indexOf(n) !== i);
  const { data: people } = useApi<{ people: Person[] }>(ambiguous ? "/api/people" : null);
  const label = (c: MemoryCollection) => {
    const owner = ambiguous ? people?.people.find((p) => p.id === c.personId)?.name : undefined;
    return owner ? `${c.name} · ${owner}` : c.name;
  };
  return (
    <Section title="Memory Details">
      <View style={{ gap: spacing.sm }}>
        <DetailRow icon="calendar-outline" label="Happened in">
          <DetailValue>{seasonOf(memory.occurredAt)}</DetailValue>
        </DetailRow>
        {memory.location ? (
          <DetailRow icon="location-outline" label="Where">
            <DetailValue>{memory.location}</DetailValue>
          </DetailRow>
        ) : null}
        {collections.length ? (
          <DetailRow icon="pricetag-outline" label={collections.length > 1 ? "Collections" : "Collection"}>
            {collections.map((c) => (
              <DetailValue key={c.id} onPress={() => openInLibrary(routes.collection(c.id))}>
                {label(c)}
              </DetailValue>
            ))}
          </DetailRow>
        ) : null}
      </View>
    </Section>
  );
}

/** The transcript side: where transcription stands, the words, and a way to edit them. */
function TranscriptPanel({
  memory,
  status,
  severalClips,
  retrying,
  onRetry,
  onEdit,
}: {
  memory: Memory;
  status: TranscriptStatus | null;
  severalClips: boolean;
  retrying: boolean;
  /** Both absent for a VIEWER, who reads the transcript but can't change it. */
  onRetry?: () => void;
  onEdit?: () => void;
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
      {status === "FAILED" ? (
        <View style={styles.transcriptState}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.accentDeep} />
          <Text style={[type.caption, { flex: 1 }]}>
            We couldn't write the transcript for {severalClips ? "a recording" : "this recording"}.
          </Text>
          {onRetry ? (
            <Button
              label={retrying ? "Trying…" : "Try again"}
              variant="secondary"
              onPress={onRetry}
              disabled={retrying}
            />
          ) : null}
        </View>
      ) : null}
      {memory.transcript ? (
        <Pressable onLongPress={onEdit} style={styles.transcriptCard}>
          <Text style={styles.transcript}>{memory.transcript}</Text>
        </Pressable>
      ) : null}
      {/* Typing one in by hand is always allowed; the pipeline never overwrites it. */}
      {onEdit && (memory.transcript || status !== "PENDING") ? (
        <Pressable onPress={onEdit} style={styles.editLink} accessibilityRole="button">
          <Ionicons name="create-outline" size={15} color={colors.accentDeep} />
          <Text style={styles.editLinkText}>
            {memory.transcript ? "Edit transcript" : "Write the transcript yourself"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

function TranscriptEditor({
  value,
  onChange,
  saving,
  error,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (text: string) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline
        autoFocus
        style={styles.editor}
        placeholder="What was said, in your words…"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Transcript"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
        <Button label={saving ? "Saving…" : "Save"} onPress={onSave} disabled={saving} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

/** The hero while Mux prepares a fresh upload: a minute or so, then the player. */
function VideoPreparing() {
  return (
    <View style={styles.videoFallback}>
      <ActivityIndicator color="rgba(255,255,255,0.8)" />
      <Text style={styles.videoFallbackText}>Preparing video…</Text>
    </View>
  );
}

/**
 * Instead of a black box. Without `onRetry` Mux couldn't make the file
 * playable (FAILED) and there's nothing to retry; with it, the player gave up
 * on a ready clip (a lapsed link, a dropped connection) and can try again.
 */
function VideoFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <View style={styles.videoFallback}>
      <Ionicons name="videocam-off-outline" size={30} color="rgba(255,255,255,0.7)" />
      <Text style={styles.videoFallbackText}>
        {onRetry ? "This video can't play right now." : "We couldn't prepare this video to play."}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.editLink} accessibilityRole="button">
          <Ionicons name="refresh-outline" size={15} color="#fff" />
          <Text style={[styles.editLinkText, { color: "#fff" }]}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const DISC = 40;

const styles = StyleSheet.create({
  goneScreen: { flex: 1, backgroundColor: colors.bg, justifyContent: "center" },
  screen: { flex: 1, backgroundColor: colors.bg },
  column: { width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center" },
  hero: { width: "100%", backgroundColor: colors.ink, overflow: "hidden" },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg + 2,
    borderTopRightRadius: radius.lg + 2,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg + 2,
    flexGrow: 1,
  },
  cardAlone: { marginTop: spacing.sm, ...shadow },
  date: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.inkSoft,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginTop: 2 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 31, lineHeight: 37, color: colors.ink },
  titleLarge: { fontSize: 36, lineHeight: 42 },
  pencil: { paddingTop: 8 },
  floating: { pointerEvents: "box-none", position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingBottom: spacing.sm },
  floatingSettled: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  actions: {
    pointerEvents: "box-none",
    width: "100%",
    maxWidth: MAX_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  actionsBar: { alignSelf: "center", paddingVertical: spacing.sm },
  actionsRight: { flexDirection: "row", gap: spacing.md },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: "center", justifyContent: "center" },
  discFloating: { backgroundColor: "rgba(255,255,255,0.94)", ...shadow },
  discFlat: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  transcriptState: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  transcriptCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  transcript: { fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 25, color: colors.ink },
  editor: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 180,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: 15.5,
    lineHeight: 25,
    color: colors.ink,
  },
  error: { ...type.caption, color: DANGER, marginTop: spacing.sm },
  editLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  editLinkText: { fontFamily: fonts.sansSemiBold, fontSize: 14, color: colors.accentDeep },
  videoFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  videoFallbackText: { fontFamily: fonts.sans, fontSize: 14, color: "#fff", textAlign: "center" },
});
