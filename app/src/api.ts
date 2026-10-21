import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { File as FsFile, UploadType } from "expo-file-system";

/**
 * v0 talks to an open API — no tokens, no session. Everything here assumes a
 * single family until accounts exist.
 */
function resolveBaseUrl() {
  const configured: string | undefined = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  // On a phone, "localhost" is the phone. Borrow the LAN host Metro is served
  // from so a device on the same network reaches the API without config.
  // Expo Go's config is typed by expo-manifests, which isn't installed.
  const goConfig: { debuggerHost?: unknown } | null = Constants.expoGoConfig;
  const debuggerHost = typeof goConfig?.debuggerHost === "string" ? goConfig.debuggerHost : undefined;
  const hostUri = Constants.expoConfig?.hostUri ?? debuggerHost;
  if (hostUri) return `http://${hostUri.split(":")[0]}:4000`;
  return "http://localhost:4000";
}

export const API_URL = resolveBaseUrl();

/** Media paths come back relative so the host can change without a migration. */
export function mediaUrl(path: string): string;
export function mediaUrl(path?: string | null): string | undefined;
export function mediaUrl(path?: string | null) {
  if (!path) return undefined;
  // Absolute URLs (presigned S3) and local URIs (a just-picked photo's
  // blob:/data:/file:) are already where the bytes are.
  return /^(https?|blob|data|file):/.test(path) ? path : `${API_URL}${path}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

/**
 * A write. `body` is optional for the contract's bodiless PUT/DELETE routes
 * (favourite, unlink, soft delete); a 204 or empty reply resolves to null.
 */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return JSON.parse((await res.text()) || "null");
}

/** `GET /api/media/limits` — the server is the one place the upload ceiling lives. */
export type UploadLimits = {
  maxUploadBytes: number;
  /** Videos longer than this are kept but not transcribed yet (SKIPPED). */
  transcribeMaxVideoSeconds: number;
};

/**
 * The sentence a family sees when a file is over the ceiling. Phrased for
 * video because that's what crosses it — a phone photo never does. Decimal
 * units, the way phones and file browsers report sizes: 2,000,000,000 bytes
 * reads "2 GB".
 */
export function tooLargeMessage(mime: string, maxUploadBytes: number) {
  const size =
    maxUploadBytes >= 1e9
      ? `${Math.floor(maxUploadBytes / 1e9)} GB`
      : `${Math.floor(maxUploadBytes / 1e6)} MB`;
  return mime.startsWith("video/")
    ? `Videos over ${size} can't be added yet — try a shorter clip.`
    : `Files over ${size} can't be added yet.`;
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
  /**
   * The object's digest — exactly one is set. `checksum` is storage's own
   * (`crc64nvme:…` on S3); `sha256` is hashed by the API when storage has none.
   */
  sha256: string | null;
  checksum: string | null;
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
      const body: Partial<UploadLimits> | null = await res.json().catch(() => null);
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
    const res = await fetch(mediaUrl(target.url), {
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
  const result = await file.upload(mediaUrl(target.url), {
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
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T is the caller's word for the response's shape
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  // A new path is loading from the render that brings it, not one render later.
  const [shownPath, setShownPath] = useState(path);
  if (path !== shownPath) {
    setShownPath(path);
    if (path) setLoading(true);
  }

  const fetchPath = useCallback(async () => {
    if (!path) return;
    try {
      const next = await apiGet<T>(path);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [path]);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    await fetchPath();
  }, [path, fetchPath]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- fetchPath only sets state once its request settles
    void fetchPath();
  }, [fetchPath]);

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
  /** Distinct kinds of media attached, in no particular order. */
  mediaTypes: MediaType[];
  /** No media at all — a story, a quote, a note. Render it as words, not a photo. */
  isTextOnly: boolean;
};

export type MediaType = "PHOTO" | "VIDEO" | "AUDIO";

/** SKIPPED: a video over the server's `transcribeMaxVideoSeconds`; not transcribed yet. */
export type TranscriptStatus = "PENDING" | "READY" | "FAILED" | "SKIPPED";

export type MediaItem = {
  id: string;
  type: MediaType;
  url: string;
  caption: string | null;
  width: number;
  height: number;
  durationS: number | null;
  isOriginal: boolean;
  /** Null for photos; audio and video clips are transcribed after upload. */
  transcriptStatus: TranscriptStatus | null;
  /** This clip's own transcript; the memory's transcript is what people read and edit. */
  transcript: string | null;
};

export type Memory = MemoryCard & {
  story: string | null;
  transcript: string | null;
  /**
   * Rolled up from the clips: PENDING if any is, else FAILED if any did, else
   * READY if any was transcribed, else SKIPPED (every clip too long); null
   * with no clips.
   */
  transcriptStatus: TranscriptStatus | null;
  createdAt: string;
  author: Person | null;
  media: MediaItem[];
  collections: MemoryCollection[];
  /** Favourited by the signed-in user — favourites are per user, not per family. */
  isFavorite: boolean;
  /** Manual links first, then suggestions sharing a collection or person, nearest in date; max 8. */
  related: MemoryCard[];
  /** Which memories were linked by hand (oldest link first) — the ones that can be unlinked. */
  linkedIds: string[];
};

/** A collection a memory is filed in, as the memory detail lists it. */
export type MemoryCollection = {
  id: string;
  name: string;
  pillar: PillarKey;
  /** The child whose collection it is; null for a family-wide one (Family Life). */
  personId: string | null;
  kind: CollectionKind | null;
  icon: string;
  color: string;
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
  /** Template key of a child's default collection; null for a family's own. */
  kind: CollectionKind | null;
  /** Disc glyph — a key of ICONS in components/journey.tsx. */
  icon: string;
  /** Disc colour, hex. */
  color: string;
};

/** The seven default child collections; the server's template module is the source. */
export type CollectionKind =
  | "milestones"
  | "day_to_day"
  | "quotes"
  | "birthdays"
  | "kindness"
  | "talents"
  | "phases";

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

/** One of the three Story Pillars, as the Library landing shows it. */
export type LibraryPillar = {
  key: PillarKey;
  name: string;
  tagline: string;
  coverUrl: string;
  /** True when the family chose this cover (`PUT /api/library/pillars/:key/cover`). */
  customCover: boolean;
};

/** `GET /api/library` */
export type LibraryPayload = { pillars: LibraryPillar[] };

/**
 * A child, with what the Child Profiles and Collections headers show.
 * `collectionCount` is their CHILD_PROFILES collections; `memoryCount` is
 * distinct, non-deleted memories in any collection of theirs.
 */
export type ChildSummary = Person & {
  photoUrl: string | null;
  collectionCount: number;
  memoryCount: number;
};

/** `GET /api/children` */
export type ChildrenPayload = { children: ChildSummary[] };

/** `GET /api/children/:id` — collections are the child's CHILD_PROFILES ones, sorted. */
export type ChildPayload = { child: ChildSummary; collections: Collection[] };

/**
 * `GET /api/collections/:id?q=&year=` — memories newest first. `years`
 * ignores the `year` filter so the chips don't vanish when one is picked.
 */
export type CollectionArchivePayload = {
  collection: Collection;
  child: ChildSummary | null;
  years: { year: number; count: number }[];
  memories: MemoryCard[];
};

/** `PATCH /api/people/:id` — `photoKey` is a finalized upload key; null removes the photo. */
export type PersonPatch = { name?: string; birthDate?: string | null; photoKey?: string | null };

/** `POST /api/collections` */
export type CollectionCreate = {
  pillar: PillarKey;
  name: string;
  description?: string | null;
  personId?: string | null;
  icon: string;
  color: string;
};

/**
 * `PATCH /api/memories/:id` — `collectionIds` replaces the whole set, which
 * covers both "add to another collection" and "move".
 */
export type MemoryPatch = {
  title?: string;
  story?: string | null;
  transcript?: string | null;
  occurredAt?: string;
  location?: string | null;
  collectionIds?: string[];
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
