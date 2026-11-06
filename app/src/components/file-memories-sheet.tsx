import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiSend, type Collection, type MemoryCard } from "../api";
import { friendlyError, shortDate } from "../format";
import { FILING_VIEWS, invalidate, useApiQuery } from "../query";
import { Ionicons } from "../styled";
import { SearchField } from "./journey";
import { CardArt } from "./memory/parts";
import { Sheet } from "./sheet";
import { InlineError } from "./ui";
import { useSettled } from "../use-settled";

export function FileMemoriesSheet({
  collection,
  onClose,
}: {
  collection: Pick<Collection, "id" | "name">;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = useSettled(query.trim(), 250);
  const searching = q.length >= 2;
  const list = useApiQuery<{ memories: MemoryCard[] }>(
    searching ? `/api/search?q=${encodeURIComponent(q)}` : "/api/memories?limit=60",
    { keepPrevious: true },
  );
  const filedNow = useApiQuery<{ memories: MemoryCard[] }>(`/api/memories?collectionId=${collection.id}&limit=100`);
  const file = useMutation({
    mutationFn: ({ memoryId, filed }: { memoryId: string; filed: boolean }) =>
      apiSend(`/api/collections/${collection.id}/memories/${memoryId}`, filed ? "PUT" : "DELETE"),
    onSuccess: () => invalidate(FILING_VIEWS),
  });
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
      await file.mutateAsync({ memoryId: memory.id, filed: next });
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
      onClose={onClose}
      title="Memories in this collection"
      subtitle={`Tick the ones that belong in ${collection.name}. Unticking only takes a memory out of here.`}
    >
      <SearchField value={query} onChangeText={setQuery} placeholder="Search memories" className="mb-2"
        style={{ height: 46 }} />
      {error ? <Text className="mt-2 font-sans text-[13.5px] text-terracotta">{error}</Text> : null}
      {list.error && !list.data ? (
        <InlineError error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />
      ) : null}
      {filedNow.error && !filedNow.data ? (
        <InlineError error={filedNow.error} onRetry={() => void filedNow.refetch()} retrying={filedNow.isFetching} />
      ) : null}
      {(list.isPending && !list.error) || (filedNow.isPending && !filedNow.error) ? (
        <ActivityIndicator colorClassName="accent-primary" className="mt-4" />
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
            className={`flex-row items-center gap-3 border-b-line py-2.5 active:opacity-60 ${working ? "opacity-60" : ""}`}
            style={{ borderBottomWidth: StyleSheet.hairlineWidth }}
          >
            <View className="h-11 w-11 overflow-hidden rounded-[8px] bg-surface-alt">
              <CardArt memory={memory} compact />
            </View>
            <View className="flex-1">
              <Text className="font-sans text-[16px] text-ink" numberOfLines={1}>
                {memory.title}
              </Text>
              <Text className="type-caption">{shortDate(memory.occurredAt)}</Text>
            </View>
            {working ? (
              <ActivityIndicator colorClassName="accent-primary" />
            ) : (
              <Ionicons
                name={on ? "checkmark-circle" : "ellipse-outline"}
                size={24}
                colorClassName={on ? "accent-primary" : "accent-line"}
              />
            )}
          </Pressable>
        );
      })}
      {list.data && memories.length === 0 ? (
        <Text className="mt-3 type-caption">{searching ? "Nothing matches that yet." : "No memories yet."}</Text>
      ) : null}
    </Sheet>
  );
}
