import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { File as FsFile, UploadType } from "expo-file-system";

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

/** `GET /api/media/limits` — the server is the one place the upload ceiling lives. */
export type UploadLimits = { maxUploadBytes: number };

/**
 * The sentence a family sees when a file is over the ceiling. Phrased for
 * video because that's what crosses it — a phone photo never does.
 */
export function tooLargeMessage(mime: string, maxUploadBytes: number) {
  const mb = Math.floor(maxUploadBytes / (1024 * 1024));
  return mime.startsWith("video/")
    ? `Videos over ${mb} MB can't be added yet — try a shorter clip.`
    : `Files over ${mb} MB can't be added yet.`;
}

/** What `POST /api/media/init` authorises. Mirrors the server's UploadTarget. */
export type UploadTarget = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export type UploadInit = { uploadId: string; key: string; target: UploadTarget };

/**
 * What `POST /api/media/finalize` observed in the bytes that actually landed —
 * pass it straight into `media[]` when creating the memory.
 */
export type FinalizedMedia = {
  key: string;
  type: "PHOTO" | "VIDEO" | "AUDIO";
  mimeType: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
};

/**
 * Two-phase upload: ask the API where to put the bytes, put them there, then
 * ask the API what it got.
 *
 * The middle step deliberately doesn't go through this server's API surface —
 * `target.url` is wherever storage says: a relative local route, or an
 * absolute presigned S3 URL (which `mediaUrl` passes through untouched). The
 * PUT sends exactly `target.headers` — with S3 they're part of the signature,
 * so adding to or changing them fails the upload.
 *
 * `onProgress` reports 0..1 and only fires on native; the web path has no
 * progress events to hook without dropping to XHR.
 */
export async function uploadFile(
  uri: string,
  name: string,
  type: string,
  onProgress?: (fraction: number) => void,
): Promise<FinalizedMedia> {
  const init = async (bytes: number): Promise<UploadInit> => {
    const res = await fetch(`${API_URL}/api/media/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mimeType: type, bytes, filename: name }),
    });
    // Over the ceiling: say so in words, with the server's own number. Nothing
    // has been uploaded yet.
    if (res.status === 413) {
      const body = (await res.json().catch(() => null)) as Partial<UploadLimits> | null;
      if (body?.maxUploadBytes) throw new Error(tooLargeMessage(type, body.maxUploadBytes));
    }
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return res.json();
  };

  if (Platform.OS === "web") {
    // Picked media on web is a blob:/data: URI; fetching it yields the bytes
    // and, more importantly, their exact length — which init has to authorise.
    const blob = await (await fetch(uri)).blob();
    const { key, target } = await init(blob.size);
    const res = await fetch(mediaUrl(target.url) as string, {
      method: target.method,
      headers: target.headers,
      body: blob,
    });
    if (!res.ok) throw new Error((await res.text()) || `Upload failed (${res.status})`);
    onProgress?.(1);
    return finalizeUpload(key);
  }

  // Native: expo-file-system streams the file straight from disk, so a large
  // video never has to be materialised in JS memory the way a Blob would.
  const file = new FsFile(uri);
  const { key, target } = await init(file.size);
  const result = await file.upload(mediaUrl(target.url) as string, {
    httpMethod: target.method,
    uploadType: UploadType.BINARY_CONTENT,
    headers: target.headers,
    mimeType: type,
    onProgress: onProgress
      ? ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0)
      : undefined,
  });
  if (result.status >= 400) throw new Error(result.body || `Upload failed (${result.status})`);
  return finalizeUpload(key);
}

async function finalizeUpload(key: string) {
  const { media } = await apiSend<{ media: FinalizedMedia }>("/api/media/finalize", "POST", { key });
  return media;
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
