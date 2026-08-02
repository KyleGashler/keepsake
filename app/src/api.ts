import { useCallback, useEffect, useState } from "react";
import Constants from "expo-constants";

/**
 * v0 talks to an open API — no tokens, no session. Everything here assumes a
 * single family until accounts exist.
 */
function resolveBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  // On a phone, "localhost" is the phone. Borrow the LAN host Metro is served
  // from so a device on the same network reaches the API without config.
  const hostUri = Constants.expoConfig?.hostUri ?? (Constants as any).expoGoConfig?.debuggerHost;
  if (hostUri) return `http://${String(hostUri).split(":")[0]}:4000`;
  return "http://localhost:4000";
}

export const API_URL = resolveBaseUrl();

/** Media paths come back relative so the host can change without a migration. */
export function mediaUrl(path?: string | null) {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

export async function apiSend<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export async function uploadFile(uri: string, name: string, type: string) {
  const form = new FormData();
  if (uri.startsWith("data:") || uri.startsWith("blob:")) {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob as unknown as Blob, name);
  } else {
    // React Native's FormData accepts this shape for local file URIs.
    form.append("file", { uri, name, type } as unknown as Blob);
  }
  const res = await fetch(`${API_URL}/api/media/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { media: { url: string; type: "PHOTO" | "VIDEO" | "AUDIO" } };
}

/** Small stand-in for a data layer; swap for React Query when caching matters. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await apiGet<T>(path));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, refetch: load };
}

// ---- Shapes returned by the API -------------------------------------------

export type Person = {
  id: string;
  name: string;
  role: "PARENT" | "CHILD" | "GRANDPARENT" | "RELATIVE" | "COLLABORATOR";
  relation: string | null;
  birthDate: string | null;
  accentColor: string;
  avatarUrl: string;
  initials: string;
};

export type MemoryCard = {
  id: string;
  title: string;
  occurredAt: string;
  location: string | null;
  heroUrl: string;
  excerpt: string | null;
  mediaCount: number;
  hasAudio: boolean;
  paletteHue: number;
  brightness: number;
  participants: Person[];
};

export type MediaItem = {
  id: string;
  type: "PHOTO" | "VIDEO" | "AUDIO";
  url: string;
  caption: string | null;
  width: number;
  height: number;
  durationS: number | null;
  isOriginal: boolean;
};

export type Memory = MemoryCard & {
  story: string | null;
  transcript: string | null;
  createdAt: string;
  author: Person | null;
  media: MediaItem[];
  collections: { id: string; name: string; pillar: PillarKey }[];
};

export type PillarKey = "ARRIVAL_STORIES" | "CHILD_PROFILES" | "FAMILY_LIFE";

export type Collection = {
  id: string;
  pillar: PillarKey;
  name: string;
  description: string | null;
  personId: string | null;
  personName: string | null;
  isDefault: boolean;
  sortOrder: number;
  coverUrl: string;
  memoryCount: number;
};

export type HomePayload = {
  family: { id: string; name: string };
  greeting: { salutation: string; message: string };
  people: Person[];
  prompt: { id: string; text: string; subtitle: string | null; imageUrl: string } | null;
  storySoFar: MemoryCard[];
  updates: {
    id: string;
    kind: string;
    message: string;
    actor: Person | null;
    createdAt: string;
  }[];
  stats: { memoryCount: number; personCount: number };
};

export type LibraryPayload = {
  pillars: {
    key: PillarKey;
    name: string;
    tagline: string;
    description: string;
    selectsPerson: boolean;
    collectionCount: number;
    coverUrl: string;
  }[];
  children: Person[];
};

export type MosaicTile = {
  id: string;
  title: string;
  occurredAt: string;
  url: string;
  isVideo: boolean;
  hasAudio: boolean;
  paletteHue: number;
  span: "single" | "wide" | "tall";
};
