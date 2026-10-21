import type { ComponentType } from "react";
import type { CollectionKind } from "./api";
import { MemoryEntry, QuoteEntry, type EntryProps } from "./components/archive-entries";

/**
 * A collection's archive (components/collection-archive.tsx): its filters and
 * how its entries are drawn.
 */

/** What the archive is narrowed to. `q` is matched by the server. */
export type ArchiveFilters = { q: string; year: number | null };

export const NO_FILTERS: ArchiveFilters = { q: "", year: null };

/** `GET /api/collections/:id?q=&year=` for a set of filters. */
export function archivePath(collectionId: string, { q, year }: ArchiveFilters) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (year !== null) params.set("year", String(year));
  const query = params.toString();
  return `/api/collections/${collectionId}${query ? `?${query}` : ""}`;
}

/** Draws one memory in an archive. */
export type EntryRenderer = ComponentType<EntryProps>;

/**
 * Entry renderers by collection kind. A new kind of collection that wants its
 * own look adds a renderer here, not a screen; any kind not listed (and a
 * family's own collections, whose kind is null) gets the photo-or-words row.
 */
const RENDERERS: Partial<Record<CollectionKind, EntryRenderer>> = {
  quotes: QuoteEntry,
};

export function entryRendererFor(kind: CollectionKind | null): EntryRenderer {
  return (kind && RENDERERS[kind]) || MemoryEntry;
}
