import { useMutation } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
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
import { collectionName, errorMessage, shortDate } from "../../src/format";
import { memoryKey, memorySaved, queryClient, useApiQuery, useRefreshOnFocus } from "../../src/query";
import { collectionHref, goBackOr, openInLibrary } from "../../src/routes";
import { Image, Ionicons } from "../../src/styled";
import { layout, MAX_WIDTH } from "../../src/theme";

const POLL_MS = 3000;
const CARD_OVERLAP = 24;

export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useApiQuery<{ memory: Memory }>(`/api/memories/${id}`, {
    refetchInterval: (data) => (data && isSettling(data.memory) ? POLL_MS : false),
  });
  const { data, error, refetch } = query;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  const [chosenView, setView] = useState<WordsView | null>(null);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoAttempt, setVideoAttempt] = useState(0);
  const [pastHero, setPastHero] = useState(false);
  const canContribute = useCanContribute();

  useRefreshOnFocus(query);
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const favorite = useMutation({
    mutationFn: (next: boolean) => apiSend(`/api/memories/${id}/favorite`, next ? "PUT" : "DELETE"),
    onMutate: (next) => setFavoriteHere(id, next),
    onError: (_err, next) => setFavoriteHere(id, !next),
  });
  const transcript = useMutation({
    mutationFn: (text: string) => apiSend<{ memory: Memory }>(`/api/memories/${id}`, "PATCH", { transcript: text }),
    // Transcripts are searched; nothing else shows them.
    onSuccess: (res) => memorySaved(res.memory, ["search"]),
  });
  const retryTranscript = useMutation({
    mutationFn: (mediaIds: string[]) =>
      Promise.allSettled(mediaIds.map((m) => apiSend(`/api/memories/${id}/media/${m}/transcribe`, "POST", {}))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: memoryKey(id), exact: true }),
  });

  const transcriptStatus = data?.memory.transcriptStatus ?? null;

  // Checked before `data`, so a refetch that finds it gone doesn't leave the old memory up.
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
  if (!data) {
    return (
      <View className="flex-1 bg-paper" style={{ paddingTop: insets.top }}>
        <TopActions floating={false} onBack={back} />
        <View className="flex-1 justify-center">
          {error ? (
            <ErrorState error={error} onRetry={() => void refetch()} retrying={query.isFetching} />
          ) : (
            <Loading />
          )}
        </View>
      </View>
    );
  }

  const memory = data.memory;
  const visuals = memory.media.filter((m) => m.type === "PHOTO" || m.type === "VIDEO");
  const recordings = memory.media.filter((m) => m.type === "AUDIO");
  const hero = visuals[0];
  const clips = memory.media.filter((m) => m.transcriptStatus !== null);

  const hasStory = Boolean(memory.story?.trim());
  const hasWords = Boolean(memory.transcript) || transcriptStatus !== null;
  const view = wordsView(hasStory, hasWords, chosenView);
  const isFavorite = memory.isFavorite;
  const pageWidth = Math.min(windowWidth, MAX_WIDTH);
  const heroHeight = Math.round(Math.min(pageWidth * 0.86, 440));

  function toggleFavorite() {
    favorite.mutate(!isFavorite);
  }

  function startTranscriptEdit() {
    setTranscriptDraft(memory.transcript ?? "");
    setSaveError(null);
    setEditingTranscript(true);
  }

  function saveTranscript() {
    setSaveError(null);
    transcript.mutate(transcriptDraft, {
      onSuccess: () => setEditingTranscript(false),
      onError: (err) => setSaveError(errorMessage(err)),
    });
  }

  function retryTranscripts() {
    retryTranscript.mutate(memory.media.filter((m) => m.transcriptStatus === "FAILED").map((m) => m.id));
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
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={
          hero
            ? (e) => setPastHero(e.nativeEvent.contentOffset.y > heroHeight - insets.top - DISC - 16)
            : undefined
        }
      >
        <View className="w-full max-w-page self-center" style={{ paddingBottom: insets.bottom + layout.bottom }}>
          {hero ? (
            <View className="w-full overflow-hidden bg-ink" style={{ height: heroHeight + CARD_OVERLAP }}>
              <HeroMedia
                hero={hero}
                paused={!focused || viewerAt !== null}
                videoFailed={videoFailed}
                videoAttempt={videoAttempt}
                onVideoError={() => setVideoFailed(true)}
                onVideoRetry={() => {
                  // A fresh signed URL: the old token may have lapsed.
                  void refetch().then(() => {
                    setVideoFailed(false);
                    setVideoAttempt((n) => n + 1);
                  });
                }}
                onOpen={() => setViewerAt(0)}
              />
            </View>
          ) : null}

          <View className={`rounded-[24px] bg-surface px-6 pt-[18px] pb-6 ${hero ? "-mt-6" : "mt-2 shadow-card"}`}>
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
                {memory.storySource === "AI_DRAFT" ? <AiDraftNote hasWords={hasWords} /> : null}
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
                    saving={transcript.isPending}
                    error={saveError}
                    onSave={saveTranscript}
                    onCancel={() => setEditingTranscript(false)}
                  />
                ) : (
                  <TranscriptPanel
                    memory={memory}
                    status={transcriptStatus}
                    severalClips={clips.length > 1}
                    retrying={retryTranscript.isPending}
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

            {visuals.length > 1 ? (
              <Section title="Media">
                <MediaGallery items={visuals} onOpen={setViewerAt} />
              </Section>
            ) : null}

            {recordings.length && view !== "transcript" ? (
              <Section title="Audio">
                <View className="gap-3">{players}</View>
              </Section>
            ) : null}

            <MemoryDetails memory={memory} />

            {memory.related.length ? (
              <Section title="Related Memories">
                <RelatedRow memories={memory.related} linkedIds={memory.linkedIds} />
              </Section>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {hero ? (
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
        onDeleted={() => {
          setSheet(null);
          back();
        }}
      />
    </View>
  );
}

function isSettling(memory: Memory) {
  return memory.transcriptStatus === "PENDING" || memory.media.some((m) => mediaStatus(m) === "PROCESSING");
}

function setFavoriteHere(memoryId: string, isFavorite: boolean) {
  queryClient.setQueryData<{ memory: Memory }>(memoryKey(memoryId), (old) =>
    old ? { memory: { ...old.memory, isFavorite } } : old,
  );
}

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

function wordsView(hasStory: boolean, hasWords: boolean, chosen: WordsView | null): WordsView | null {
  if (hasStory && hasWords) return chosen ?? "story";
  if (hasStory) return "story";
  if (hasWords) return "transcript";
  return null;
}

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
        // Keyed by id: a new signed URL on each poll must not rebuild the player.
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

type EditHandlers = {
  more?: () => void;
  edit?: () => void;
  retry?: () => void;
  editTranscript?: () => void;
};

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
  favorite?: boolean;
  onBack: () => void;
  onFavorite?: () => void;
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
        {onFavorite ? (
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
        ) : null}
        {onMore ? (
          <Pressable onPress={onMore} hitSlop={8} accessibilityRole="button" accessibilityLabel="More options" className={disc}>
            <Ionicons name="ellipsis-horizontal" size={20} colorClassName="accent-ink" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function MemoryDetails({ memory }: { memory: Memory }) {
  const collections = memory.collections;
  const names = collections.map((c) => c.name);
  const ambiguous = names.some((n, i) => names.indexOf(n) !== i);
  const { data: people } = useApiQuery<{ people: Person[] }>(ambiguous ? "/api/people" : null);
  const label = (c: MemoryCollection) => {
    const owner = ambiguous ? people?.people.find((p) => p.id === c.personId)?.name : undefined;
    return owner ? `${collectionName(c)} · ${owner}` : collectionName(c);
  };
  return (
    <Section title="Memory Details">
      <View className="gap-2">
        {memory.location ? (
          <DetailRow icon="location-outline" label="Where">
            <DetailValue>{memory.location}</DetailValue>
          </DetailRow>
        ) : null}
        {collections.length ? (
          <DetailRow icon="pricetag-outline" label={collections.length > 1 ? "Collections" : "Collection"}>
            {collections.map((c) => (
              <DetailValue key={c.id} onPress={() => openInLibrary(collectionHref(c))}>
                {label(c)}
              </DetailValue>
            ))}
          </DetailRow>
        ) : null}
      </View>
    </Section>
  );
}

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

function AiDraftNote({ hasWords }: { hasWords: boolean }) {
  return (
    <View className="mb-2.5 flex-row items-center gap-1.5 self-start rounded-full bg-accent-soft px-2.5 py-1">
      <Ionicons name="sparkles-outline" size={13} colorClassName="accent-accent-deep" />
      <Text className="font-sans-semibold text-[12.5px] text-accent-deep">
        {hasWords ? "Drafted by AI from the Original Words" : "Drafted by AI"}
      </Text>
    </View>
  );
}

function VideoPreparing() {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-4">
      <ActivityIndicator colorClassName="accent-white/80" />
      <Text className="text-center font-sans text-[14px] text-white">Preparing video…</Text>
    </View>
  );
}

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
