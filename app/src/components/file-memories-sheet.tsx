import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiSend, useApi, type Collection, type MemoryCard } from "../api";
import { friendlyError, shortDate } from "../format";
import { colors, fonts, spacing, type } from "../theme";
import { SearchField } from "./journey";
import { CardArt } from "./memory/parts";
import { Sheet } from "./sheet";

/** `text`, once it has stopped changing for `ms`. */
function useSettled(text: string, ms: number) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

/**
 * Choose which of the family's memories are filed in this collection: tick
 * to add, untick to take one out (the memory itself stays in the archive).
 * Each tap saves at once; the collection reloads when the sheet closes.
 * The same filing a memory's "Add to Another Collection" changes, from the
 * collection's side.
 */
export function FileMemoriesSheet({
  collection,
  onClose,
}: {
  collection: Pick<Collection, "id" | "name">;
  /** Closed; `changed` says whether anything was filed or unfiled. */
  onClose: (changed: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const q = useSettled(query.trim(), 250);
  const searching = q.length >= 2;
  const list = useApi<{ memories: MemoryCard[] }>(
    searching ? `/api/search?q=${encodeURIComponent(q)}` : "/api/memories?limit=60",
  );
  const filedNow = useApi<{ memories: MemoryCard[] }>(`/api/memories?collectionId=${collection.id}&limit=100`);
  // What this sheet has changed, over what the server said when it opened.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filedIds = new Set<string>();
  for (const m of filedNow.data?.memories ?? []) filedIds.add(m.id);
  const isFiled = (id: string) => overrides.get(id) ?? filedIds.has(id);
  const memories = list.data?.memories ?? [];

  async function toggle(memory: MemoryCard) {
    const next = !isFiled(memory.id);
    setBusy(memory.id);
    setError(null);
    try {
      await apiSend(`/api/collections/${collection.id}/memories/${memory.id}`, next ? "PUT" : "DELETE");
      setOverrides((prev) => new Map(prev).set(memory.id, next));
    } catch (err) {
      setError(friendlyError(err, "That didn't save. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      visible
      onClose={() => onClose(overrides.size > 0)}
      title="Memories in this collection"
      subtitle={`Tick the ones that belong in ${collection.name}. Unticking only takes a memory out of here.`}
    >
      <SearchField value={query} onChangeText={setQuery} placeholder="Search memories" style={styles.search} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {(list.loading && !list.data) || (filedNow.loading && !filedNow.data) ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : null}
      {memories.map((memory) => {
        const on = isFiled(memory.id);
        const working = busy === memory.id;
        return (
          <Pressable
            key={memory.id}
            onPress={() => void toggle(memory)}
            disabled={busy !== null}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={memory.title}
            style={({ pressed }) => [styles.row, (pressed || working) && { opacity: 0.6 }]}
          >
            <View style={styles.thumb}>
              <CardArt memory={memory} compact />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {memory.title}
              </Text>
              <Text style={type.caption}>{shortDate(memory.occurredAt)}</Text>
            </View>
            {working ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? colors.primary : colors.line} />
            )}
          </Pressable>
        );
      })}
      {list.data && memories.length === 0 ? (
        <Text style={styles.empty}>{searching ? "Nothing matches that yet." : "No memories yet."}</Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: { height: 46, marginBottom: spacing.sm },
  error: { fontFamily: fonts.sans, fontSize: 13.5, color: colors.terracotta, marginTop: spacing.sm },
  empty: { ...type.caption, marginTop: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  name: { fontFamily: fonts.sans, fontSize: 16, color: colors.ink },
  thumb: { width: 44, height: 44, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceAlt },
});
