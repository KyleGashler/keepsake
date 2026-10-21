import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  apiSend,
  useApi,
  type Collection,
  type Memory,
  type MemoryCard,
  type MemoryPatch,
  type PillarKey,
} from "../../api";
import { errorMessage, isoDay, longDate, shortDate, withDay } from "../../format";
import { colors, fonts, radius, spacing, type } from "../../theme";
import { IconDisc, SearchField } from "../journey";
import { fieldStyles } from "./field-styles";
import { CardArt } from "./parts";
import { DANGER } from "./helpers";
import { FieldLabel, Sheet, SheetHeader, SheetRow } from "./sheet";
import { DateField } from "./date-field";

export type SheetKind = "options" | "edit" | "collections" | "link" | "date" | "delete";

/**
 * Everything behind the ⋯ button, in one sheet whose contents change: the
 * options menu, and the edit form, collection picker, link picker, date mover
 * and delete confirmation it leads to.
 */
export function MemorySheets({
  memory,
  kind,
  onKind,
  onChanged,
  onDeleted,
}: {
  memory: Memory;
  kind: SheetKind | null;
  onKind: (next: SheetKind | null) => void;
  /** Something was saved; load the memory again. */
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
}) {
  const close = () => onKind(null);
  const tall = kind === "edit" || kind === "collections" || kind === "link";
  return (
    <Sheet visible={kind !== null} onClose={close} tall={tall}>
      {kind === "options" ? <OptionsMenu onPick={onKind} /> : null}
      {kind === "edit" ? <EditForm memory={memory} onClose={close} onSaved={onChanged} /> : null}
      {kind === "collections" ? <CollectionPicker memory={memory} onClose={close} onSaved={onChanged} /> : null}
      {kind === "link" ? <LinkPicker memory={memory} onClose={close} onSaved={onChanged} /> : null}
      {kind === "date" ? <MoveDate memory={memory} onClose={close} onSaved={onChanged} /> : null}
      {kind === "delete" ? <ConfirmDelete memory={memory} onClose={close} onDeleted={onDeleted} /> : null}
    </Sheet>
  );
}

function OptionsMenu({ onPick }: { onPick: (kind: SheetKind) => void }) {
  return (
    <View>
      <SheetRow icon="pencil-outline" label="Edit Memory" onPress={() => onPick("edit")} />
      <SheetRow icon="albums-outline" label="Add to Another Collection" onPress={() => onPick("collections")} />
      <SheetRow icon="link-outline" label="Link to Another Memory" onPress={() => onPick("link")} />
      {/* Sharing has to respect permissions before anything leaves the archive. */}
      <SheetRow icon="share-outline" label="Share" disabled note="Coming soon" />
      <SheetRow icon="calendar-outline" label="Move to Different Date" onPress={() => onPick("date")} />
      <SheetRow icon="trash-outline" label="Delete" danger divider={false} onPress={() => onPick("delete")} />
    </View>
  );
}

/** Send a PATCH and reload; returns an error message, or null when it worked. */
async function patch(memory: Memory, body: MemoryPatch, onSaved: () => Promise<void> | void) {
  try {
    await apiSend(`/api/memories/${memory.id}`, "PATCH", body);
    await onSaved();
    return null;
  } catch (err) {
    return errorMessage(err, "That didn't save. Try again.");
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function EditForm({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
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
    const failed = await patch(memory, body, onSaved);
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
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <View>
          <FieldLabel>Title</FieldLabel>
          <View style={fieldStyles.input}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="A name for this memory"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Title"
              maxLength={160}
              style={fieldStyles.text}
            />
          </View>
        </View>
        <View>
          <FieldLabel>Date</FieldLabel>
          <DateField value={day} onChange={setDay} />
          {occurredAt === null ? <Text style={styles.error}>That isn't a date we can read.</Text> : null}
        </View>
        <View>
          <FieldLabel>Description</FieldLabel>
          <View style={fieldStyles.input}>
            <TextInput
              value={story}
              onChangeText={setStory}
              placeholder="What happened, and why it mattered…"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Description"
              multiline
              style={[fieldStyles.text, fieldStyles.multiline]}
            />
          </View>
        </View>
        <View>
          <FieldLabel>Location</FieldLabel>
          <View style={fieldStyles.input}>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Where it happened"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Location"
              maxLength={160}
              style={fieldStyles.text}
            />
          </View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </>
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

function CollectionPicker({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { data, error, loading } = useApi<{ collections: Collection[] }>("/api/collections");
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
    const failed = await patch(memory, { collectionIds: ids }, onSaved);
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
      <Text style={styles.hint}>
        Tick every collection this memory belongs in. Filing it in a sibling's collection shows it there too.
      </Text>
      <SearchField value={query} onChangeText={setQuery} placeholder="Find a collection" style={styles.search} />
      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        {loading && !data ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}
        {error && !data ? <Text style={styles.error}>Couldn't load collections. {error.message}</Text> : null}
        {groups.map((group) => (
          <View key={group.key} style={{ marginTop: spacing.lg }}>
            <Text style={type.label}>{group.title}</Text>
            {group.collections.map((c) => {
              const on = chosen.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={c.personName ? `${c.name}, ${c.personName}` : c.name}
                  style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.6 }]}
                >
                  <IconDisc icon={c.icon} color={c.color} size={34} />
                  <Text style={styles.pickName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={on ? colors.primary : colors.line}
                  />
                </Pressable>
              );
            })}
          </View>
        ))}
        {data && groups.length === 0 ? <Text style={styles.empty}>No collection by that name.</Text> : null}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** `text`, once it has stopped changing for `ms`. */
function useSettled(text: string, ms: number) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

function LinkPicker({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const q = useSettled(query.trim(), 250);
  const searching = q.length >= 2;
  const { data, loading } = useApi<{ memories: MemoryCard[] }>(
    searching ? `/api/search?q=${encodeURIComponent(q)}` : "/api/memories?limit=40",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedSet = new Set(memory.linkedIds);
  const linked = memory.related.filter((m) => linkedSet.has(m.id));
  const candidates = (data?.memories ?? []).filter((m) => m.id !== memory.id && !linkedSet.has(m.id));

  async function run(id: string, request: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await request();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, "That didn't save. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const link = (id: string) =>
    run(id, () => apiSend(`/api/memories/${memory.id}/links`, "POST", { linkedId: id }));
  const unlink = (id: string) =>
    run(id, () => apiSend(`/api/memories/${memory.id}/links/${id}`, "DELETE"));

  return (
    <>
      <SheetHeader title="Link a Memory" action={{ label: "Done", onPress: onClose }} />
      <SearchField value={query} onChangeText={setQuery} placeholder="Search memories" style={styles.search} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        {linked.length ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={type.label}>Linked</Text>
            {linked.map((m) => (
              <MemoryPickRow
                key={m.id}
                memory={m}
                busy={busy === m.id}
                trailing={<Ionicons name="close-circle" size={22} color={colors.muted} />}
                actionLabel={`Unlink ${m.title}`}
                onPress={() => unlink(m.id)}
              />
            ))}
          </View>
        ) : null}
        <View style={{ marginTop: spacing.lg }}>
          <Text style={type.label}>{searching ? "Matches" : "Recent memories"}</Text>
          {loading && !data ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : null}
          {candidates.map((m) => (
            <MemoryPickRow
              key={m.id}
              memory={m}
              busy={busy === m.id}
              trailing={<Ionicons name="add-circle-outline" size={24} color={colors.primary} />}
              actionLabel={`Link ${m.title}`}
              onPress={() => link(m.id)}
            />
          ))}
          {data && candidates.length === 0 ? (
            <Text style={styles.empty}>{searching ? "Nothing matches that yet." : "No other memories yet."}</Text>
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
      style={({ pressed }) => [styles.pickRow, (pressed || busy) && { opacity: 0.6 }]}
    >
      <View style={styles.pickThumb}>
        <CardArt memory={memory} compact />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pickName} numberOfLines={1}>
          {memory.title}
        </Text>
        <Text style={type.caption}>{shortDate(memory.occurredAt)}</Text>
      </View>
      {busy ? <ActivityIndicator color={colors.primary} /> : trailing}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

function MoveDate({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [day, setDay] = useState(isoDay(memory.occurredAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const occurredAt = withDay(memory.occurredAt, day);

  async function save() {
    if (!occurredAt) return;
    if (occurredAt === memory.occurredAt) return onClose();
    setSaving(true);
    setError(null);
    const failed = await patch(memory, { occurredAt }, onSaved);
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
      <Text style={styles.hint}>Now on {longDate(memory.occurredAt)}. It moves everywhere it's filed.</Text>
      <View style={{ marginTop: spacing.md, marginBottom: spacing.lg }}>
        <FieldLabel>New date</FieldLabel>
        <DateField value={day} onChange={setDay} accessibilityLabel="New date" />
        {occurredAt === null ? <Text style={styles.error}>That isn't a date we can read.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

function ConfirmDelete({ memory, onClose, onDeleted }: { memory: Memory; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await apiSend(`/api/memories/${memory.id}`, "DELETE");
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "That didn't work. Try again."));
      setDeleting(false);
    }
  }

  return (
    <View style={{ paddingBottom: spacing.sm }}>
      <Text style={styles.confirmTitle}>Delete “{memory.title}”?</Text>
      <Text style={[styles.hint, { textAlign: "center" }]}>
        It will leave every collection it's filed in. The original photos and recordings are kept safe.
      </Text>
      {error ? <Text style={[styles.error, { textAlign: "center" }]}>{error}</Text> : null}
      <Pressable
        onPress={remove}
        disabled={deleting}
        accessibilityRole="button"
        style={({ pressed }) => [styles.deleteButton, (pressed || deleting) && { opacity: 0.75 }]}
      >
        <Text style={styles.deleteLabel}>{deleting ? "Deleting…" : "Delete Memory"}</Text>
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" style={styles.keepButton}>
        <Text style={styles.keepLabel}>Keep it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 21, color: colors.inkSoft },
  search: { height: 46, marginTop: spacing.md },
  error: { fontFamily: fonts.sans, fontSize: 13.5, color: DANGER, marginTop: spacing.sm },
  empty: { ...type.caption, marginTop: spacing.md },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pickName: { flex: 1, fontFamily: fonts.sans, fontSize: 16, color: colors.ink },
  pickThumb: { width: 44, height: 44, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  confirmTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  deleteButton: {
    marginTop: spacing.xl,
    backgroundColor: DANGER,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteLabel: { fontFamily: fonts.sansBold, fontSize: 16, color: "#fff" },
  keepButton: { marginTop: spacing.sm, paddingVertical: 12, alignItems: "center" },
  keepLabel: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: colors.ink },
});
