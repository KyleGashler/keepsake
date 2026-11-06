import { useFocusEffect } from "expo-router";
import { focusManager, QueryClient, useQuery, type QueryKey, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { ApiError, apiGet, type Memory } from "./api";
import { getFamilyId, useFamilyId } from "./auth/family-store";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Bounds how long another member's change (or Mux finishing a clip) can go unseen.
      staleTime: 30_000,
      retry: (failures, error) => failures < 2 && isTransient(error),
    },
    mutations: { retry: false },
  },
});

function isTransient(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

// TanStack treats a visible web tab as focus; on native the app returning to the foreground is that moment.
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
}

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
  refetchInterval?: (data: T | undefined) => number | false;
  keepPrevious?: boolean;
  staleTime?: number;
  scope?: "family" | "account";
};

export function useApiQuery<T>(path: string | null, options: ApiQueryOptions<T> = {}): UseQueryResult<T> {
  const familyId = useFamilyId();
  const account = options.scope === "account";
  const { refetchInterval, keepPrevious } = options;
  return useQuery<T>({
    queryKey: account ? accountKey(path ?? "") : familyKey(familyId, path ?? ""),
    queryFn: () => {
      if (path === null) throw new Error("No path to fetch.");
      // This render's family, so an answer can't land under a family switched to mid-flight.
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

export const FILING_VIEWS: Resource[] = ["memories", "collections", "children"];

export const COLLECTION_VIEWS: Resource[] = [
  "collections",
  "children",
  "library",
  "people",
  "memories",
  "search",
  "family",
];

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

function startsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));
}

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

export function memoryKey(memoryId: string) {
  return familyKey(getFamilyId(), `/api/memories/${memoryId}`);
}

export function memorySaved(memory: Memory, touched: Resource[]) {
  const key = memoryKey(memory.id);
  queryClient.setQueryData(key, { memory });
  return invalidate(touched, [key]);
}

// Not refetched: the screen showing it is on its way out, and a refetch would flash "not found".
export function gone(path: string): QueryKey {
  const key = familyKey(getFamilyId(), path);
  void queryClient.invalidateQueries({ queryKey: key, refetchType: "none" });
  return key;
}

export function memoryDeleted(memoryId: string) {
  return invalidate(MEMORY_VIEWS, [gone(`/api/memories/${memoryId}`)]);
}

export function forgetEverything() {
  void queryClient.cancelQueries();
  queryClient.clear();
}

export function forgetFamily(familyId: string) {
  void queryClient.cancelQueries({ queryKey: ["family", familyId] });
  queryClient.removeQueries({ queryKey: ["family", familyId] });
}

export function forgetFamiliesExcept(familyIds: string[]) {
  queryClient.removeQueries({
    predicate: (query) => {
      const [scope, family] = query.queryKey;
      return scope === "family" && !familyIds.some((id) => id === family);
    },
  });
}
