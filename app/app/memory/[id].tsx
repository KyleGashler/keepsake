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
import { MemorySheets, type SheetKind } from "../../src/components/memory/sheets";
import { MediaViewer } from "../../src/components/memory/viewer";
import { WaveformPlayer } from "../../src/components/memory/waveform";
import { Button, ErrorState, Loading, NotFoundState } from "../../src/components/ui";
import { useCanContribute } from "../../src/auth/session-context";
import { errorMessage, seasonOf, shortDate } from "../../src/format";
import { goBackOr, openInLibrary, routes } from "../../src/routes";
import { Image, Ionicons } from "../../src/styled";
import { layout, MAX_WIDTH } from "../../src/theme";

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
      <View className="flex-1 justify-center bg-paper" style={{ paddingTop: insets.top }}>
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
      // A VIEWER's menu holds only Download, so they get ⋯ when there's media.
      onMore={can.more ?? (memory.media.length > 0 ? () => setSheet("options") : undefined)}
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
      <View key={clip.id} className="flex-row items-center gap-3 rounded-md bg-surface-alt p-3">
        {status === "FAILED" ? (
          <Ionicons name="alert-circle-outline" size={18} colorClassName="accent-accent-deep" />
        ) : (
          <ActivityIndicator colorClassName="accent-accent-deep" size="small" />
        )}
        <Text className="flex-1 type-caption">
          {status === "FAILED" ? "This recording couldn't be prepared to play." : "Preparing audio…"}
        </Text>
      </View>
    );
  });

  return (
    <View className="flex-1 bg-paper">
      {hero ? null : <View style={{ paddingTop: insets.top }}>{actions}</View>}
      <ScrollView
        className="flex-1 bg-paper"
        contentContainerClassName="grow"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={
          hero
            ? (e) => setPastHero(e.nativeEvent.contentOffset.y > heroHeight - insets.top - DISC - 16)
            : undefined
        }
      >
        <View className="w-full max-w-page grow self-center">
          {hero ? (
            <View className="w-full overflow-hidden bg-ink" style={{ height: heroHeight + CARD_OVERLAP }}>
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
            // Over a hero, -mt-6 rides the card up by CARD_OVERLAP.
            className={`grow rounded-t-[24px] bg-surface px-6 pt-[18px] ${hero ? "-mt-6" : "mt-2 shadow-card"}`}
            style={{ paddingBottom: insets.bottom + layout.bottom }}
          >
            {view && hasStory && hasWords ? (
              <View className="mb-4">
                <WordsToggle
                  value={view}
                  onChange={(next) => {
                    setView(next);
                    setEditingTranscript(false);
                  }}
                />
              </View>
            ) : null}

            <Text className="font-sans-semibold text-[13px] tracking-[0.6px] text-ink-soft uppercase">
              {shortDate(memory.occurredAt)}
            </Text>
            <View className="mt-0.5 flex-row items-start gap-3">
              <Text
                className={`flex-1 font-display text-ink ${hero ? "text-[31px] leading-[37px]" : "text-[36px] leading-[42px]"}`}
                accessibilityRole="header"
              >
                {memory.title}
              </Text>
              {can.edit ? (
                <Pressable
                  onPress={() => setSheet("edit")}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Edit memory"
                  className="pt-2 active:opacity-60"
                >
                  <Ionicons name="pencil-outline" size={20} colorClassName="accent-ink-soft" />
                </Pressable>
              ) : null}
            </View>

            {view === "story" && memory.story ? (
              <Pressable
                onLongPress={can.edit}
                className="mt-2"
              >
                <StoryText story={memory.story} textOnly={memory.isTextOnly} />
              </Pressable>
            ) : null}
            {view === "transcript" ? (
              <View className="mt-3 gap-3">
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
              <Pressable
                onPress={() => setSheet("edit")}
                className="mt-2 flex-row items-center gap-1.5"
                accessibilityRole="button"
              >
                <Ionicons name="create-outline" size={15} colorClassName="accent-accent-deep" />
                <Text className="font-sans-semibold text-[14px] text-accent-deep">Write the story of this memory</Text>
              </Pressable>
            ) : null}

            {memory.participants.length ? (
              <View className="mt-4">
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
                <View className="gap-3">{players}</View>
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
        // the buttons so they don't sit on top of the words. Until then its
        // hairline is there but transparent.
        <View
          className={`absolute top-0 right-0 left-0 items-center pb-2 ${pastHero ? "border-line bg-surface" : "border-transparent"}`}
          style={{ pointerEvents: "box-none", paddingTop: insets.top + 8, borderBottomWidth: StyleSheet.hairlineWidth }}
        >
          {actions}
        </View>
      ) : null}

      <MediaViewer items={visuals} index={viewerAt} onClose={() => setViewerAt(null)} />
      <MemorySheets
        memory={memory}
        canContribute={canContribute}
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
      className="absolute inset-0"
    >
      <Image
        source={{ uri: mediaUrl(hero.url) }}
        className="absolute inset-0"
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
  /** Absent for a VIEWER when there's nothing to download: every other option changes the memory. */
  onMore?: () => void;
}) {
  const disc = `h-10 w-10 items-center justify-center rounded-full ${
    floating ? "bg-white/94 shadow-card" : "border border-line bg-surface"
  }`;
  return (
    <View
      className={`w-full max-w-page flex-row items-center justify-between px-4 ${floating ? "" : "self-center py-2"}`}
      style={{ pointerEvents: "box-none" }}
    >
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" className={disc}>
        <Ionicons name="chevron-back" size={22} colorClassName="accent-ink" className="-ml-0.5" />
      </Pressable>
      <View className="flex-row gap-3">
        <Pressable
          onPress={onFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favorite ? "Remove from favourites" : "Favourite this memory"}
          accessibilityState={{ selected: favorite }}
          className={disc}
        >
          <Ionicons
            name={favorite ? "heart" : "heart-outline"}
            size={21}
            colorClassName={favorite ? "accent-terracotta" : "accent-ink"}
          />
        </Pressable>
        {onMore ? (
          <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel="More options" className={disc}>
            <Ionicons name="ellipsis-horizontal" size={20} colorClassName="accent-ink" />
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
      <View className="gap-2">
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
        <View className="flex-row items-center gap-3 rounded-md bg-surface-alt p-3">
          <ActivityIndicator colorClassName="accent-accent-deep" size="small" />
          <Text className="flex-1 type-caption">
            {memory.transcript
              ? "Still transcribing a recording — this will update when it's done."
              : "Transcribing… the words will appear here in a moment."}
          </Text>
        </View>
      ) : null}
      {status === "FAILED" ? (
        <View className="flex-row items-center gap-3 rounded-md bg-surface-alt p-3">
          <Ionicons name="alert-circle-outline" size={18} colorClassName="accent-accent-deep" />
          <Text className="flex-1 type-caption">
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
        <Pressable onLongPress={onEdit} className="rounded-md border border-line bg-paper p-4">
          <Text className="font-sans text-[15.5px] leading-[25px] text-ink">{memory.transcript}</Text>
        </Pressable>
      ) : null}
      {/* Typing one in by hand is always allowed; the pipeline never overwrites it. */}
      {onEdit && (memory.transcript || status !== "PENDING") ? (
        <Pressable onPress={onEdit} className="mt-2 flex-row items-center gap-1.5" accessibilityRole="button">
          <Ionicons name="create-outline" size={15} colorClassName="accent-accent-deep" />
          <Text className="font-sans-semibold text-[14px] text-accent-deep">
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
        className="min-h-[180px] rounded-md border border-line bg-surface p-4 font-sans text-[15.5px] leading-[25px] text-ink"
        // Android only; no class sets it.
        style={{ textAlignVertical: "top" }}
        placeholder="What was said, in your words…"
        placeholderTextColorClassName="accent-muted"
        accessibilityLabel="Transcript"
      />
      {error ? <Text className="mt-2 type-caption text-danger">{error}</Text> : null}
      <View className="mt-3 flex-row gap-3">
        <Button label={saving ? "Saving…" : "Save"} onPress={onSave} disabled={saving} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </View>
    </View>
  );
}

/** The hero while Mux prepares a fresh upload: a minute or so, then the player. */
function VideoPreparing() {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-4">
      <ActivityIndicator colorClassName="accent-white/80" />
      <Text className="text-center font-sans text-[14px] text-white">Preparing video…</Text>
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
    <View className="flex-1 items-center justify-center gap-2 p-4">
      <Ionicons name="videocam-off-outline" size={30} colorClassName="accent-white/70" />
      <Text className="text-center font-sans text-[14px] text-white">
        {onRetry ? "This video can't play right now." : "We couldn't prepare this video to play."}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} className="mt-2 flex-row items-center gap-1.5" accessibilityRole="button">
          <Ionicons name="refresh-outline" size={15} colorClassName="accent-white" />
          <Text className="font-sans-semibold text-[14px] text-white">Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const DISC = 40;
