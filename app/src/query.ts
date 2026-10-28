import { useFocusEffect } from "expo-router";
import { focusManager, QueryClient, useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { ApiError, apiGet, type Memory } from "./api";
import { getFamilyId, useFamilyId } from "./auth/family-store";

/**
 * The client's data layer: every read from the API is a TanStack Query, and
 * every write a mutation that says which reads it changed (A8b).
 *
 * Keys come from the path, under the family that asked:
 * `GET /api/collections/abc?year=2024` in family F is
 * `["family", F, "collections", "abc", { year: "2024" }]`. So a different
 * family is a different key (a cache miss, never another family's data), and
 * `["family", F, "collections"]` is every collection read in F at once — the
 * prefix a mutation invalidates. Reads that belong to the person rather than
 * a family (`/api/me/deletion`, an invite preview) live under `["account"]`.
 *
 * `apiFetch` (src/api.ts) is still the one place the bearer, `x-family-id`
 * and 401 → sign-out live; the queries here only call it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Writes invalidate what they touch, so this only bounds how long
      // another member's change (or Mux finishing a clip) can go unseen
      // before a return to the screen, or to the app, looks again.
      staleTime: 30_000,
      retry: (failures, error) => failures < 2 && isTransient(error),
    },
    mutations: { retry: false },
  },
});

/** A dropped connection or a 5xx is worth another go; a 4xx answer won't change. */
function isTransient(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

// On the web, TanStack already treats the tab becoming visible as focus.
// On a phone, the app coming back to the foreground is the same moment.
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
}

/**
 * The first path segment after `/api/` — what a screen reads, and what a
 * mutation says it touched.
 */
export type Resource =
  | "home"
  | "mosaic"
  | "library"
  | "children"
  | "collections"
  | "memories"
  | "people"
  | "search"
  | "family"
  | "media";

/** `/api/collections/abc?year=2024` → `["collections", "abc", { year: "2024" }]`. */
function pathKey(path: string): unknown[] {
  const [pathname, search] = path.split("?", 2);
  const parts: unknown[] = pathname
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (search) {
    const params: Record<string, string> = {};
    for (const pair of search.split("&")) {
      if (!pair) continue;
      const [k, v = ""] = pair.split("=", 2);
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    }
    parts.push(params);
  }
  return parts;
}

export function familyKey(familyId: string | null, path: string): QueryKey {
  return ["family", familyId, ...pathKey(path)];
}

function accountKey(path: string): QueryKey {
  return ["account", ...pathKey(path)];
}

export type ApiQueryOptions<T> = {
  /** Poll while the data says something is still in progress; `false` stops. */
  refetchInterval?: (data: T | undefined) => number | false;
  /**
   * While a new path loads (a search, a filter), keep showing the last answer
   * instead of a spinner — never across families.
   */
  keepPrevious?: boolean;
  staleTime?: number;
  /** `account`: the person's own data, not any one family's. */
  scope?: "family" | "account";
};

/**
 * `GET path` as a query. `null` waits (nothing is fetched). The family is the
 * one this render is looking at, and the request carries that family even if
 * the choice changes while it's in flight, so an answer can't land under a
 * family it wasn't asked for.
 */
export function useApiQuery<T>(path: string | null, options: ApiQueryOptions<T> = {}): UseQueryResult<T> {
  const familyId = useFamilyId();
  const account = options.scope === "account";
  const { refetchInterval, keepPrevious } = options;
  return useQuery<T>({
    queryKey: account ? accountKey(path ?? "") : familyKey(familyId, path ?? ""),
    queryFn: () => {
      if (path === null) throw new Error("No path to fetch.");
      return apiGet<T>(path, account ? undefined : familyId);
    },
    enabled: path !== null,
    staleTime: options.staleTime,
    refetchInterval: refetchInterval ? (query) => refetchInterval(query.state.data) : undefined,
    placeholderData: keepPrevious
      ? (previous, previousQuery) => (previousQuery?.queryKey[1] === familyId ? previous : undefined)
      : undefined,
  });
}

/**
 * Coming back to a screen that stayed mounted underneath (a tab, a stack
 * screen under a memory) looks again if what it shows has gone stale. Not on
 * the first focus — that's the mount, which has just fetched.
 */
export function useRefreshOnFocus(query: Pick<UseQueryResult, "refetch" | "isStale">) {
  const latest = useRef(query);
  useEffect(() => {
    latest.current = query;
  });
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current && latest.current.isStale) void latest.current.refetch();
      focusedBefore.current = true;
    }, []),
  );
}

// ---- What a write touches ---------------------------------------------------

/**
 * Every screen a memory shows on or is counted by: its own page (and the
 * related memories on others), Home's story and stats, the Mosaic, every
 * collection's archive and counts, each child's counts, a person's memories,
 * search, and Family Hub's stats.
 */
export const MEMORY_VIEWS: Resource[] = [
  "memories",
  "home",
  "mosaic",
  "collections",
  "children",
  "people",
  "search",
  "family",
];

/** Filing a memory in a collection, or taking it out: the archives, their counts, the memory's own page. */
export const FILING_VIEWS: Resource[] = ["memories", "collections", "children"];

/**
 * A collection made, renamed or deleted: the lists and archives, each
 * child's collections and counts, the pillar counts, a person's collections,
 * the names on a memory's page, search, and Family Hub's count.
 */
export const COLLECTION_VIEWS: Resource[] = [
  "collections",
  "children",
  "library",
  "people",
  "memories",
  "search",
  "family",
];

/**
 * Someone added or edited: Your People on Home, the people lists, children
 * (and the Library's), names and faces on memories and in archives, search,
 * and Family Hub.
 */
export const PEOPLE_VIEWS: Resource[] = [
  "people",
  "children",
  "library",
  "home",
  "memories",
  "collections",
  "search",
  "family",
];

/** Whether `key` is `prefix` or lies under it. */
function startsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));
}

/**
 * Mark what a write changed as stale; whatever is on screen (or mounted under
 * it) loads again now, the rest when it's next opened. `except` are keys
 * (and everything under them) the write has already dealt with — filled in
 * from its own answer, or `gone` — so they aren't fetched again.
 */
export function invalidate(resources: Resource[] | "everything", except: QueryKey[] = []) {
  const familyId = getFamilyId();
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const [scope, family, resource] = query.queryKey;
      if (scope !== "family" || family !== familyId) return false;
      if (resources !== "everything" && !resources.some((r) => r === resource)) return false;
      return !except.some((key) => startsWith(query.queryKey, key));
    },
  });
}

/** The key of one memory's page in the current family. */
export function memoryKey(memoryId: string) {
  return familyKey(getFamilyId(), `/api/memories/${memoryId}`);
}

/**
 * A memory route answered with the memory as it is now: show that at once,
 * and mark `touched` stale everywhere else it appears.
 */
export function memorySaved(memory: Memory, touched: Resource[]) {
  const key = memoryKey(memory.id);
  queryClient.setQueryData(key, { memory });
  return invalidate(touched, [key]);
}

/**
 * Something opened by id was deleted here. Its page is marked stale but not
 * fetched now — the screen showing it is on its way out, and a refetch would
 * flash "not found" as it goes — so it's never shown again from the cache.
 * Returns the key, for `invalidate`'s `except`.
 */
export function gone(path: string): QueryKey {
  const key = familyKey(getFamilyId(), path);
  void queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
  return key;
}

/** A memory is gone: refresh everything that listed it. */
export function memoryDeleted(memoryId: string) {
  return invalidate(MEMORY_VIEWS, [gone(`/api/memories/${memoryId}`)]);
}

// ---- Forgetting ------------------------------------------------------------

/**
 * Signed out, or someone else signed in: nothing cached may outlive the
 * person it was fetched for.
 */
export function forgetEverything() {
  void queryClient.cancelQueries();
  queryClient.clear();
}

/** A family deleted, left or lost: drop what was cached for it. */
export function forgetFamily(familyId: string) {
  void queryClient.cancelQueries({ queryKey: ["family", familyId] });
  queryClient.removeQueries({ queryKey: ["family", familyId] });
}

/** Keep only the families the person still belongs to. */
export function forgetFamiliesExcept(familyIds: string[]) {
  queryClient.removeQueries({
    predicate: (query) => {
      const [scope, family] = query.queryKey;
      return scope === "family" && !familyIds.some((id) => id === family);
    },
  });
}
