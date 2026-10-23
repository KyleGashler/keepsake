import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { File as FsFile, UploadType } from "expo-file-system";
import { auth } from "./auth";
import { getFamilyId, useFamilyId } from "./auth/family-store";

/**
 * Every call to the API carries the signed-in person's token and the family
 * they're looking at (see `apiFetch`). Media bytes don't: they load as plain
 * URLs — public placeholders, signed read URLs, Mux's signed playback — with
 * no headers at all.
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

/** A request the API answered with an error status — kept, so a screen can tell "gone" from "broken". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The API's `error` code when it sent one (`forbidden_role`, `verify_email`, …). */
    readonly code?: string,
    /** The whole JSON body, for the few callers that need more than the code. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The family's roles allow reading this but not changing it (a VIEWER, or a
 * CONTRIBUTOR at an owner-only control). The UI hides what a role can't do;
 * this is for whatever slips through — a stale role, a deep link.
 */
export function isForbiddenRole(err: unknown) {
  return err instanceof ApiError && err.code === "forbidden_role";
}

const FORBIDDEN_ROLE_MESSAGE = "Your role in this family doesn't allow that. An owner can change it in Family Hub.";

/** An error response as an ApiError: the `error` code if the body is JSON, the text otherwise. */
async function errorFrom(res: Response) {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the text is the message.
  }
  const code =
    body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : undefined;
  const message = code === "forbidden_role" ? FORBIDDEN_ROLE_MESSAGE : text || res.statusText;
  return new ApiError(res.status, message, code, body);
}

/**
 * The thing asked for isn't there: deleted, from another family, or a stale
 * link. The API answers all three with 404 and doesn't say which.
 */
export function isNotFound(err: unknown) {
  return err instanceof ApiError && err.status === 404;
}

/**
 * What a 401 does. The session (src/auth/session.tsx) replaces this so it can
 * say why the person is back at the sign-in screen; until then, sign out.
 */
let unauthorizedHandler: () => void = () => void auth.signOut();

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

/**
 * `fetch` against this API, signed: `Authorization: Bearer <token>` and, once
 * a family is chosen, `x-family-id`. A 401 means the token is no good any
 * more (expired past refresh, revoked, or minted for another project), so the
 * person is signed out rather than left looking at errors.
 *
 * Only for `API_URL` paths. Upload targets (presigned S3, Mux, the local
 * provider's tokened URL) are signed in their URL and must get nothing extra.
 *
 * `familyId` defaults to the current choice; `useApi` passes the one it
 * rendered with, so a response can't land under a family it wasn't asked for.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  familyId: string | null = getFamilyId(),
): Promise<Response> {
  const token = await auth.getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (familyId) headers.set("x-family-id", familyId);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && token) unauthorizedHandler();
  return res;
}

export async function apiGet<T>(path: string, familyId?: string | null): Promise<T> {
  const res = await apiFetch(path, {}, familyId);
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

/**
 * A write. `body` is optional for the contract's bodiless PUT/DELETE routes
 * (favourite, unlink, delete); a 204 or empty reply resolves to null.
 */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
  return JSON.parse((await res.text()) || "null");
}

/** `GET /api/media/limits` — the server is the one place the upload ceiling lives. */
export type UploadLimits = { maxUploadBytes: number };

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

/**
 * What `POST /api/media/init` authorises. Mirrors the server's UploadTarget.
 * For audio and video it's a Mux direct upload (`key` is `mux:<uploadId>`):
 * a plain PUT of the file to Mux, usually with no headers at all.
 */
export type UploadTarget = {
  url: string;
  method: "PUT";
  /** Sent exactly as given; may be empty (Mux) or missing. */
  headers?: Record<string, string>;
  /** Storage uploads say when the URL lapses; a Mux upload may not. */
  expiresAt?: string;
};

export type UploadInit = { uploadId?: string; key: string; target: UploadTarget };

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
   * The object's digest — for a storage upload exactly one is set. `checksum`
   * is storage's own (`crc64nvme:…` on S3); `sha256` is hashed by the API when
   * storage has none. A Mux upload (`mux:` key) has neither: Mux validates the
   * file and fails the asset if it can't decode it.
   */
  sha256?: string | null;
  checksum?: string | null;
  width?: number;
  height?: number;
};

/**
 * Two-phase upload: ask the API where to put the bytes, put them there, then
 * ask the API what it got.
 *
 * The middle step deliberately doesn't go through `apiFetch` (no bearer, no
 * family header) or this server's API surface —
 * `target.url` is wherever the API says: a relative local route, an absolute
 * presigned S3 URL, or (audio and video) a Mux direct upload URL; `mediaUrl`
 * passes absolute ones through untouched. The PUT sends exactly
 * `target.headers` — with S3 they're part of the signature, so adding to or
 * changing them fails the upload. Mux wants none; the file body is enough.
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
    const res = await apiFetch("/api/media/init", {
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
    if (!res.ok) throw await errorFrom(res);
    return res.json();
  };

  if (Platform.OS === "web") {
    // Picked media on web is a blob:/data: URI; fetching it yields the bytes
    // and, more importantly, their exact length — which init has to authorise.
    const blob = await (await fetch(uri)).blob();
    const { key, target } = await init(blob.size);
    const res = await fetch(mediaUrl(target.url), {
      method: target.method,
      headers: target.headers ?? {},
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
    headers: target.headers ?? {},
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
  // A different family is a different answer to the same path.
  const familyId = useFamilyId();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  // A new path is loading from the render that brings it, not one render later.
  const [shownPath, setShownPath] = useState(path);
  if (path !== shownPath) {
    setShownPath(path);
    if (path) setLoading(true);
  }

  // Only the newest request may land. With the path changing quickly (a
  // debounced search), an older, slower response would otherwise overwrite
  // the newer one; a refresh superseded by a new path is dropped the same way.
  const latestRequest = useRef(0);
  const fetchPath = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!path) return;
    try {
      const next = await apiGet<T>(path, familyId);
      if (request !== latestRequest.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (request !== latestRequest.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [path, familyId]);

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

export type MembershipRole = "OWNER" | "CONTRIBUTOR" | "VIEWER";

/** One family the signed-in person belongs to. */
export type Membership = {
  familyId: string;
  familyName: string;
  role: MembershipRole;
  personId: string | null;
};

/** `GET /api/me` — reachable before belonging to any family. */
export type MePayload = {
  user: { id: string; email: string; displayName: string; emailVerified: boolean; createdAt: string };
  memberships: Membership[];
};

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
  /** An image, always: the first photo, a video's Mux poster (never the video), or a generated stand-in. */
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

export type TranscriptStatus = "PENDING" | "READY" | "FAILED";

/**
 * Where an audio or video clip is in Mux's processing. PROCESSING until Mux
 * has an asset ready to play; FAILED when Mux couldn't decode the file.
 */
export type MediaStatus = "PROCESSING" | "READY" | "FAILED";

export type MediaItem = {
  id: string;
  type: MediaType;
  /**
   * Photo: a read URL. Video: a signed Mux HLS playlist (`….m3u8?token=…`).
   * Audio: a signed Mux `audio.m4a`. Null for a clip until it's READY.
   */
  url: string | null;
  /**
   * Audio and video only. Photos may leave it out (or say READY); read it
   * through `mediaStatus`.
   */
  status?: MediaStatus | null;
  /** Video only: a signed Mux poster frame (a JPEG). Null until READY. */
  posterUrl?: string | null;
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

/**
 * A photo is always READY; a clip says where Mux is with it. A clip with no
 * status at all is treated as READY when it has a URL to play.
 */
export function mediaStatus(item: Pick<MediaItem, "type" | "status" | "url">): MediaStatus {
  if (item.type === "PHOTO") return "READY";
  return item.status ?? (item.url ? "READY" : "PROCESSING");
}

export type Memory = MemoryCard & {
  story: string | null;
  transcript: string | null;
  /**
   * Rolled up from the clips: PENDING if any is, else FAILED if any did, else
   * READY if any was transcribed; null with no clips.
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
 * distinct memories in any collection of theirs.
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
export type PersonPatch = {
  name?: string;
  relation?: string | null;
  birthDate?: string | null;
  photoKey?: string | null;
};

/** `POST /api/people` — a child also gets their default collections. */
export type PersonCreate = { name: string; role: Person["role"]; relation?: string; birthDate?: string };

/** `GET /api/people/:id` */
export type PersonDetail = {
  person: Person;
  /**
   * Signs in as a member of this family. `DELETE /api/people/:id` refuses a
   * member (`409 person_is_member`): an owner removes them in Family Hub first.
   */
  isMember: boolean;
  memoryCount: number;
  memories: MemoryCard[];
  collections: { id: string; name: string; pillar: PillarKey }[];
};

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
 * `PATCH /api/collections/:id` — any collection, a child's defaults included
 * (they keep their `kind`). Only collections without a `kind` can be deleted
 * (`DELETE /api/collections/:id`; `409 default_collection` otherwise).
 */
export type CollectionPatch = { name?: string; description?: string | null; icon?: string; color?: string };

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
  /** An image, like `MemoryCard.heroUrl`: a video tile gets its poster. */
  url: string;
  isVideo: boolean;
  hasAudio: boolean;
  paletteHue: number;
  span: "single" | "wide" | "tall";
};

// ---- Family Hub, roles and invites -----------------------------------------

/** One account in the family (a FamilyMembership). */
export type FamilyMember = {
  userId: string;
  role: MembershipRole;
  /** The role in words, from the server ("Owner", "Can add memories", "Can view"). */
  permission: string;
  name: string;
  /** Shown to owners, and to each member for themselves; otherwise null. */
  email: string | null;
  isYou: boolean;
  /** How they appear in the archive; null if their Person was removed. */
  person: Person | null;
  joinedAt: string;
};

/** Someone in the archive without an account: a child, or an adult not yet invited. */
export type FamilyPerson = Person & {
  /** Not a child and not linked to an account — an invite can name them. */
  invitable: boolean;
};

/** `GET /api/family` */
export type FamilyPayload = {
  family: { id: string; name: string; createdAt: string };
  /** The caller's own role here. */
  role: MembershipRole;
  members: FamilyMember[];
  people: FamilyPerson[];
  stats: { memoryCount: number; mediaCount: number; collectionCount: number; personCount: number };
  subscription: { plan: string; status: string };
};

export type InviteStatus = "valid" | "expired" | "used" | "revoked";

/** An invite as its family's owners see it (`/api/family/invites`). */
export type Invite = {
  id: string;
  role: MembershipRole;
  email: string | null;
  personId: string | null;
  /** The Person it names, or the name typed for someone new; null for neither. */
  forName: string | null;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  /** The link to share: `<app>/join/<token>`. */
  url: string;
};

/** `POST /api/family/invites` */
export type InviteCreate = {
  role: MembershipRole;
  email?: string;
  personId?: string;
  name?: string;
};

/** `GET /api/invites/:token` — public, so only what the join screen shows. */
export type InvitePreview = {
  familyName: string;
  inviterName: string;
  role: MembershipRole;
  forName: string | null;
  status: InviteStatus;
  expiresAt: string;
};

/** `POST /api/invites/:token/accept` */
export type AcceptedInvite = { membership: Membership };
