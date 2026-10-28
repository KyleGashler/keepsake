import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  apiSend,
  type Collection,
  type MediaItem,
  type Memory,
  type MemoryCard,
  type MemoryPatch,
  type PillarKey,
} from "../../api";
import { confirmAction } from "../../confirm";
import { duration, errorMessage, isoDay, longDate, refusalMessage, shortDate, withDay } from "../../format";
import {
  FILING_VIEWS,
  MEMORY_VIEWS,
  memoryDeleted,
  memoryKey,
  memorySaved,
  queryClient,
  useApiQuery,
  type Resource,
} from "../../query";
import { Ionicons, type IoniconName } from "../../styled";
import { IconDisc, SearchField } from "../journey";
import { fieldBox, fieldMultiline, fieldText } from "./field-styles";
import { Thumb } from "./gallery";
import { CardArt } from "./parts";
import { InlineError } from "../ui";
import { FieldLabel, Sheet, SheetHeader, SheetRow } from "./sheet";
import { DateField } from "./date-field";
import { DownloadList } from "./download-sheet";
import { useSettled } from "../../use-settled";

/** A sheet's quiet explanation under its header. */
const HINT = "font-sans text-[14.5px] leading-[21px] text-ink-soft";
/** A sentence that went wrong, in red under what it's about. */
const ERROR = "mt-2 font-sans text-[13.5px] text-danger";
/** Nothing to list. */
const EMPTY = "mt-3 type-caption";
/** A row in a picker list; give it `style={HAIRLINE_BELOW}` for the line under it. */
const PICK_ROW = "flex-row items-center gap-3 border-line py-2.5";
const PICK_NAME = "flex-1 font-sans text-[16px] text-ink";
const PICK_THUMB = "h-11 w-11 overflow-hidden rounded-[8px] bg-surface-alt";
const HAIRLINE_BELOW = { borderBottomWidth: StyleSheet.hairlineWidth };

export type SheetKind = "options" | "edit" | "media" | "collections" | "link" | "date" | "delete" | "download";

/**
 * Everything behind the ⋯ button, in one sheet whose contents change: the
 * options menu, and the edit form, media arranger, collection picker, link
 * picker, date mover, delete confirmation and download list it leads to.
 */
export function MemorySheets({
  memory,
  canContribute,
  kind,
  onKind,
  onDeleted,
}: {
  memory: Memory;
  /** False for a VIEWER: the menu offers only Download. */
  canContribute: boolean;
  kind: SheetKind | null;
  onKind: (next: SheetKind | null) => void;
  onDeleted: () => void;
}) {
  const close = () => onKind(null);
  const tall = kind === "edit" || kind === "media" || kind === "collections" || kind === "link";
  return (
    <Sheet visible={kind !== null} onClose={close} tall={tall}>
      {kind === "options" ? (
        <OptionsMenu hasMedia={memory.media.length > 0} canContribute={canContribute} onPick={onKind} />
      ) : null}
      {kind === "download" ? <DownloadList memory={memory} onClose={close} /> : null}
      {kind === "media" ? <MediaArranger memory={memory} onClose={close} /> : null}
      {kind === "edit" ? <EditForm memory={memory} onClose={close} /> : null}
      {kind === "collections" ? <CollectionPicker memory={memory} onClose={close} /> : null}
      {kind === "link" ? <LinkPicker memory={memory} onClose={close} /> : null}
      {kind === "date" ? <MoveDate memory={memory} onClose={close} /> : null}
      {kind === "delete" ? <ConfirmDelete memory={memory} onClose={close} onDeleted={onDeleted} /> : null}
    </Sheet>
  );
}

function OptionsMenu({
  hasMedia,
  canContribute,
  onPick,
}: {
  hasMedia: boolean;
  canContribute: boolean;
  onPick: (kind: SheetKind) => void;
}) {
  const download = hasMedia ? (
    <SheetRow
      icon="download-outline"
      label="Download"
      divider={canContribute}
      onPress={() => onPick("download")}
    />
  ) : null;
  if (!canContribute) return <View>{download}</View>;
  return (
    <View>
      <SheetRow icon="pencil-outline" label="Edit Memory" onPress={() => onPick("edit")} />
      {hasMedia ? (
        <SheetRow icon="images-outline" label="Arrange Photos & Recordings" onPress={() => onPick("media")} />
      ) : null}
      <SheetRow icon="albums-outline" label="Add to Another Collection" onPress={() => onPick("collections")} />
      <SheetRow icon="link-outline" label="Link to Another Memory" onPress={() => onPick("link")} />
      {/* Sharing has to respect permissions before anything leaves the archive. */}
      <SheetRow icon="share-outline" label="Share" disabled note="Coming soon" />
      {download}
      <SheetRow icon="calendar-outline" label="Move to Different Date" onPress={() => onPick("date")} />
      <SheetRow icon="trash-outline" label="Delete" danger divider={false} onPress={() => onPick("delete")} />
    </View>
  );
}

/**
 * A write to this memory. Every memory route answers with the memory as it
 * is now, so the page shows that at once; `touched` is where else it shows.
 */
function useMemoryWrite<V>(request: (vars: V) => Promise<{ memory: Memory }>, touched: Resource[]) {
  return useMutation({ mutationFn: request, onSuccess: (res) => memorySaved(res.memory, touched) });
}

/** PATCH the memory; resolves to an error message, or null when it worked. */
function usePatch(memory: Memory, touched: Resource[]) {
  const { mutateAsync } = useMemoryWrite(
    (body: MemoryPatch) => apiSend<{ memory: Memory }>(`/api/memories/${memory.id}`, "PATCH", body),
    touched,
  );
  return async function save(body: MemoryPatch) {
    try {
      await mutateAsync(body);
      return null;
    } catch (err) {
      return errorMessage(err, "That didn't save. Try again.");
    }
  };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function EditForm({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  // Title, story, place and date show wherever the memory does.
  const patch = usePatch(memory, MEMORY_VIEWS);
  const [title, setTitle] = useState(memory.title);
  const [day, setDay] = useState(isoDay(memory.occurredAt));
  const [story, setStory] = useState(memory.story ?? "");
  const [location, setLocation] = useState(memory.location ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const occurredAt = withDay(memory.occurredAt, day);
  const valid = title.trim().length > 0 && occurredAt !== null;

  async function save() {
    if (!valid || !occurredAt) return;
    setSaving(true);
    setError(null);
    const body: MemoryPatch = {
      title: title.trim(),
      story: story.trim() ? story : null,
      location: location.trim() || null,
      ...(occurredAt !== memory.occurredAt ? { occurredAt } : {}),
    };
    const failed = await patch(body);
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <>
      <SheetHeader
        title="Edit Memory"
        onCancel={onClose}
        action={{ label: saving ? "Saving…" : "Save", onPress: save, disabled: saving || !valid }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 pb-4">
        <View>
          <FieldLabel>Title</FieldLabel>
          <View className={fieldBox}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="A name for this memory"
              placeholderTextColorClassName="accent-muted"
              accessibilityLabel="Title"
              maxLength={160}
              className={fieldText}
            />
          </View>
        </View>
        <View>
          <FieldLabel>Date</FieldLabel>
          <DateField value={day} onChange={setDay} />
          {occurredAt === null ? <Text className={ERROR}>That isn't a date we can read.</Text> : null}
        </View>
        <View>
          <FieldLabel>Description</FieldLabel>
          <View className={fieldBox}>
            <TextInput
              value={story}
              onChangeText={setStory}
              placeholder="What happened, and why it mattered…"
              placeholderTextColorClassName="accent-muted"
              accessibilityLabel="Description"
              multiline
              className={`${fieldText} ${fieldMultiline}`}
              style={{ textAlignVertical: "top" }}
            />
          </View>
        </View>
        <View>
          <FieldLabel>Location</FieldLabel>
          <View className={fieldBox}>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Where it happened"
              placeholderTextColorClassName="accent-muted"
              accessibilityLabel="Location"
              maxLength={160}
              className={fieldText}
            />
          </View>
        </View>
        {error ? <Text className={ERROR}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Arrange media
// ---------------------------------------------------------------------------

const MEDIA_NOUN: Record<MediaItem["type"], string> = { PHOTO: "photo", VIDEO: "video", AUDIO: "recording" };

/**
 * Every photo, video and recording on the memory, in order: move one up or
 * down (the first photo or video is the hero everywhere the memory shows),
 * or remove it for good. Arrows rather than dragging, so it works the same
 * with a finger, a mouse and a screen reader. Each change saves at once.
 */
function MediaArranger({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const items = memory.media;
  // The first photo is the memory's face everywhere, and the counts move.
  const write = useMemoryWrite((request: () => Promise<{ memory: Memory }>) => request(), MEMORY_VIEWS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, request: () => Promise<{ memory: Memory }>) {
    setBusy(id);
    setError(null);
    try {
      await write.mutateAsync(request);
    } catch (err) {
      setError(refusalMessage(err, "That didn't save. Try again."));
    } finally {
      setBusy(null);
    }
  }

  function move(index: number, by: -1 | 1) {
    const ids = items.map((m) => m.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void run(moved, () => apiSend<{ memory: Memory }>(`/api/memories/${memory.id}/media/order`, "PUT", { mediaIds: ids }));
  }

  async function remove(item: MediaItem) {
    const noun = MEDIA_NOUN[item.type];
    const ok = await confirmAction({
      title: `Remove this ${noun}?`,
      message: `It's deleted from “${memory.title}” for everyone in the family, along with the original file. This can't be undone.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await run(item.id, () => apiSend<{ memory: Memory }>(`/api/memories/${memory.id}/media/${item.id}`, "DELETE"));
  }

  return (
    <>
      <SheetHeader title="Arrange" action={{ label: "Done", onPress: onClose }} />
      <Text className={HINT}>The first photo or video leads the memory everywhere it appears.</Text>
      {error ? <Text className={ERROR}>{error}</Text> : null}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="mt-2 pb-4">
        {items.map((item, i) => {
          const noun = MEDIA_NOUN[item.type];
          const label = `${noun[0].toUpperCase()}${noun.slice(1)} ${i + 1}`;
          const working = busy === item.id;
          return (
            <View
              key={item.id}
              className={`${PICK_ROW} ${busy !== null && !working ? "opacity-60" : ""}`}
              style={HAIRLINE_BELOW}
            >
              <View className={PICK_THUMB}>
                {item.type === "AUDIO" ? (
                  <View className="flex-1 items-center justify-center">
                    <Ionicons name="mic-outline" size={20} colorClassName="accent-ink-soft" />
                  </View>
                ) : (
                  <Thumb item={item} />
                )}
              </View>
              <View className="flex-1">
                <Text className={PICK_NAME} numberOfLines={1}>
                  {item.caption ?? label}
                </Text>
                {subtitle(item, i) ? <Text className="type-caption">{subtitle(item, i)}</Text> : null}
              </View>
              {working ? (
                <ActivityIndicator colorClassName="accent-primary" />
              ) : (
                <View className="flex-row gap-1.5">
                  <ArrangeButton icon="chevron-up" label={`Move ${label} up`} disabled={busy !== null || i === 0} onPress={() => move(i, -1)} />
                  <ArrangeButton
                    icon="chevron-down"
                    label={`Move ${label} down`}
                    disabled={busy !== null || i === items.length - 1}
                    onPress={() => move(i, 1)}
                  />
                  <ArrangeButton icon="trash-outline" label={`Remove ${label}`} danger disabled={busy !== null} onPress={() => void remove(item)} />
                </View>
              )}
            </View>
          );
        })}
        {items.length === 0 ? <Text className={EMPTY}>No photos or recordings left on this memory.</Text> : null}
      </ScrollView>
    </>
  );
}

/** Under an item's name: that it leads the memory, or a clip's length. */
function subtitle(item: MediaItem, index: number) {
  if (index === 0 && item.type !== "AUDIO") return "Leads the memory";
  return duration(item.durationS) || null;
}

function ArrangeButton({
  icon,
  label,
  onPress,
  disabled,
  danger = false,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`h-[34px] w-[34px] items-center justify-center rounded-full border border-line active:opacity-60 ${disabled ? "opacity-30" : ""}`}
    >
      <Ionicons name={icon} size={18} colorClassName={danger ? "accent-danger" : "accent-ink"} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const PILLAR_NAMES: Record<PillarKey, string> = {
  CHILD_PROFILES: "Child Profiles",
  ARRIVAL_STORIES: "Arrival Stories",
  FAMILY_LIFE: "Family Life",
};
const PILLAR_ORDER: PillarKey[] = ["CHILD_PROFILES", "ARRIVAL_STORIES", "FAMILY_LIFE"];

type Group = { key: string; title: string; collections: Collection[] };

/** "Banks" for a child's own collections, "Banks · Arrival Stories", "Family Life". */
function groupTitle(c: Collection) {
  if (c.pillar === "FAMILY_LIFE" || !c.personName) return PILLAR_NAMES[c.pillar];
  if (c.pillar === "CHILD_PROFILES") return c.personName;
  return `${c.personName} · ${PILLAR_NAMES[c.pillar]}`;
}

/**
 * The family's collections in groups — each child's own first (the children
 * this memory is already filed under leading), then each child's Arrival
 * Stories, then Family Life. Filing a memory in a sibling's collection is how
 * it shows up under them too.
 */
function groupCollections(collections: Collection[], filedIn: Set<string>): Group[] {
  const groups = new Map<string, Group>();
  for (const c of collections) {
    const key = `${c.pillar}:${c.personId ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, title: groupTitle(c), collections: [] };
      groups.set(key, group);
    }
    group.collections.push(c);
  }
  const touches = (g: Group) => g.collections.some((c) => filedIn.has(c.id));
  return [...groups.values()].toSorted((a, b) => {
    const pillar =
      PILLAR_ORDER.indexOf(a.collections[0].pillar) - PILLAR_ORDER.indexOf(b.collections[0].pillar);
    if (pillar !== 0) return pillar;
    if (touches(a) !== touches(b)) return touches(a) ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

function CollectionPicker({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const collectionsQuery = useApiQuery<{ collections: Collection[] }>("/api/collections");
  const { data, error } = collectionsQuery;
  const patch = usePatch(memory, FILING_VIEWS);
  const original = useMemo(() => new Set(memory.collections.map((c) => c.id)), [memory.collections]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(original));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.collections ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (c.personName ?? "").toLowerCase().includes(q),
    );
    return groupCollections(list, original);
  }, [data, query, original]);

  const changed = chosen.size !== original.size || [...chosen].some((id) => !original.has(id));

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!changed) return onClose();
    setSaving(true);
    setSaveError(null);
    // Keep the existing order and add the new ones after it.
    const ids = [...memory.collections.map((c) => c.id).filter((id) => chosen.has(id)), ...[...chosen].filter((id) => !original.has(id))];
    const failed = await patch({ collectionIds: ids });
    setSaving(false);
    if (failed) setSaveError(failed);
    else onClose();
  }

  return (
    <>
      <SheetHeader
        title="Collections"
        onCancel={onClose}
        action={{ label: saving ? "Saving…" : "Done", onPress: save, disabled: saving }}
      />
      <Text className={HINT}>
        Tick every collection this memory belongs in. Filing it in a sibling's collection shows it there too.
      </Text>
      <SearchField value={query} onChangeText={setQuery} placeholder="Find a collection" className="mt-3" style={{ height: 46 }} />
      {saveError ? <Text className={ERROR}>{saveError}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerClassName="pb-4">
        {collectionsQuery.isPending && !error ? <ActivityIndicator colorClassName="accent-primary" className="mt-6" /> : null}
        {error && !data ? (
          <InlineError error={error} onRetry={() => void collectionsQuery.refetch()} retrying={collectionsQuery.isFetching} />
        ) : null}
        {groups.map((group) => (
          <View key={group.key} className="mt-4">
            <Text className="type-label">{group.title}</Text>
            {group.collections.map((c) => {
              const on = chosen.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={c.personName ? `${c.name}, ${c.personName}` : c.name}
                  className={`${PICK_ROW} active:opacity-60`}
                  style={HAIRLINE_BELOW}
                >
                  <IconDisc icon={c.icon} color={c.color} size={34} />
                  <Text className={PICK_NAME} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    colorClassName={on ? "accent-primary" : "accent-line"}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}
        {data && groups.length === 0 ? <Text className={EMPTY}>No collection by that name.</Text> : null}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------


function LinkPicker({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = useSettled(query.trim(), 250);
  const searching = q.length >= 2;
  const results = useApiQuery<{ memories: MemoryCard[] }>(
    searching ? `/api/search?q=${encodeURIComponent(q)}` : "/api/memories?limit=40",
    { keepPrevious: true },
  );
  const { data } = results;
  // A link shows on both memories' pages, and nowhere else.
  const write = useMutation({
    mutationFn: ({ linkedId, linked }: { linkedId: string; linked: boolean }) =>
      linked
        ? apiSend<{ memory: Memory }>(`/api/memories/${memory.id}/links`, "POST", { linkedId })
        : apiSend<{ memory: Memory }>(`/api/memories/${memory.id}/links/${linkedId}`, "DELETE"),
    onSuccess: (res, { linkedId }) => {
      void memorySaved(res.memory, []);
      return queryClient.invalidateQueries({ queryKey: memoryKey(linkedId), exact: true });
    },
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedSet = new Set(memory.linkedIds);
  const linkedNow = memory.related.filter((m) => linkedSet.has(m.id));
  const candidates = (data?.memories ?? []).filter((m) => m.id !== memory.id && !linkedSet.has(m.id));

  async function run(id: string, linked: boolean) {
    setBusy(id);
    setError(null);
    try {
      await write.mutateAsync({ linkedId: id, linked });
    } catch (err) {
      setError(errorMessage(err, "That didn't save. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const link = (id: string) => run(id, true);
  const unlink = (id: string) => run(id, false);

  return (
    <>
      <SheetHeader title="Link a Memory" action={{ label: "Done", onPress: onClose }} />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search memories" className="mt-3" style={{ height: 46 }} />
      {error ? <Text className={ERROR}>{error}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerClassName="pb-4">
        {linkedNow.length ? (
          <View className="mt-4">
            <Text className="type-label">Linked</Text>
            {linkedNow.map((m) => (
              <MemoryPickRow
                key={m.id}
                memory={m}
                busy={busy === m.id}
                trailing={<Ionicons name="close-circle" size={22} colorClassName="accent-muted" />}
                actionLabel={`Unlink ${m.title}`}
                onPress={() => unlink(m.id)}
              />
            ))}
          </View>
        ) : null}
        <View className="mt-4">
          <Text className="type-label">{searching ? "Matches" : "Recent memories"}</Text>
          {results.isPending && !results.error ? <ActivityIndicator colorClassName="accent-primary" className="mt-4" /> : null}
          {results.error && !data ? (
            <InlineError error={results.error} onRetry={() => void results.refetch()} retrying={results.isFetching} />
          ) : null}
          {candidates.map((m) => (
            <MemoryPickRow
              key={m.id}
              memory={m}
              busy={busy === m.id}
              trailing={<Ionicons name="add-circle-outline" size={24} colorClassName="accent-primary" />}
              actionLabel={`Link ${m.title}`}
              onPress={() => link(m.id)}
            />
          ))}
          {data && candidates.length === 0 ? (
            <Text className={EMPTY}>{searching ? "Nothing matches that yet." : "No other memories yet."}</Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function MemoryPickRow({
  memory,
  trailing,
  actionLabel,
  onPress,
  busy,
}: {
  memory: MemoryCard;
  trailing: React.ReactNode;
  actionLabel: string;
  onPress: () => void;
  busy: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={actionLabel}
      className={`${PICK_ROW} active:opacity-60 ${busy ? "opacity-60" : ""}`}
      style={HAIRLINE_BELOW}
    >
      <View className={PICK_THUMB}>
        <CardArt memory={memory} compact />
      </View>
      <View className="flex-1">
        <Text className={PICK_NAME} numberOfLines={1}>
          {memory.title}
        </Text>
        <Text className="type-caption">{shortDate(memory.occurredAt)}</Text>
      </View>
      {busy ? <ActivityIndicator colorClassName="accent-primary" /> : trailing}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

function MoveDate({ memory, onClose }: { memory: Memory; onClose: () => void }) {
  // A date orders every list the memory is in.
  const patch = usePatch(memory, MEMORY_VIEWS);
  const [day, setDay] = useState(isoDay(memory.occurredAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const occurredAt = withDay(memory.occurredAt, day);

  async function save() {
    if (!occurredAt) return;
    if (occurredAt === memory.occurredAt) return onClose();
    setSaving(true);
    setError(null);
    const failed = await patch({ occurredAt });
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <>
      <SheetHeader
        title="Move Date"
        onCancel={onClose}
        action={{ label: saving ? "Saving…" : "Save", onPress: save, disabled: saving || !occurredAt }}
      />
      <Text className={HINT}>Now on {longDate(memory.occurredAt)}. It moves everywhere it's filed.</Text>
      <View className="mt-3 mb-4">
        <FieldLabel>New date</FieldLabel>
        <DateField value={day} onChange={setDay} accessibilityLabel="New date" />
        {occurredAt === null ? <Text className={ERROR}>That isn't a date we can read.</Text> : null}
        {error ? <Text className={ERROR}>{error}</Text> : null}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function ConfirmDelete({ memory, onClose, onDeleted }: { memory: Memory; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const deletion = useMutation({
    mutationFn: () => apiSend(`/api/memories/${memory.id}`, "DELETE"),
    onSuccess: () => memoryDeleted(memory.id),
  });
  // Still "Deleting…" after it worked, while the page goes away.
  const deleting = deletion.isPending || deletion.isSuccess;

  function remove() {
    setError(null);
    deletion.mutate(undefined, {
      onSuccess: onDeleted,
      onError: (err) => setError(errorMessage(err, "That didn't work. Try again.")),
    });
  }

  return (
    <View className="pb-2">
      <Text className="my-2 text-center font-display text-[24px] leading-[30px] text-ink">
        Delete “{memory.title}”?
      </Text>
      <Text className={`${HINT} text-center`}>
        It's deleted for everyone in the family, along with its photos, videos and recordings — the original files
        too. There's no trash, so this can't be undone.
      </Text>
      {error ? <Text className={`${ERROR} text-center`}>{error}</Text> : null}
      <Pressable
        onPress={remove}
        disabled={deleting}
        accessibilityRole="button"
        className={`mt-6 items-center rounded-full bg-danger py-3.5 active:opacity-75 ${deleting ? "opacity-75" : ""}`}
      >
        <Text className="font-sans-bold text-[16px] text-white">{deleting ? "Deleting…" : "Delete Memory"}</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" className="mt-2 items-center py-3">
        <Text className="font-sans-semibold text-[16px] text-ink">Keep it</Text>
      </Pressable>
    </View>
  );
}
