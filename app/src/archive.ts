import type { ComponentType } from "react";
import type { CollectionKind } from "./api";
import { MemoryEntry, QuoteEntry, type EntryProps } from "./components/archive-entries";

export type ArchiveFilters = { q: string; year: number | null };

export const NO_FILTERS: ArchiveFilters = { q: "", year: null };

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// The server buckets years in the device's zone so year chips agree with the local dates entries show.
export function archivePath(path: string, { q, year }: ArchiveFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  if (q.trim()) params.set("q", q.trim());
  if (year !== null) params.set("year", String(year));
  const tz = deviceTimeZone();
  if (tz) params.set("tz", tz);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export type EntryRenderer = ComponentType<EntryProps>;

const RENDERERS: Partial<Record<CollectionKind, EntryRenderer>> = {
  quotes: QuoteEntry,
};

export function entryRendererFor(kind: CollectionKind | null): EntryRenderer {
  return (kind && RENDERERS[kind]) || MemoryEntry;
}
