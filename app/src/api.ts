import { Platform } from "react-native";
import Constants from "expo-constants";
import { File as FsFile, UploadType } from "expo-file-system";
import { auth } from "./auth";
import { getFamilyId } from "./auth/family-store";
import type { DraftAsset } from "./draft";

function resolveBaseUrl() {
  const configured: string | undefined = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");
  // On a phone "localhost" is the phone; use the LAN host Metro is served from.
  // expoGoConfig's real type lives in expo-manifests, which isn't installed.
  const goConfig: { debuggerHost?: unknown } | null = Constants.expoGoConfig;
  const debuggerHost = typeof goConfig?.debuggerHost === "string" ? goConfig.debuggerHost : undefined;
  const hostUri = Constants.expoConfig?.hostUri ?? debuggerHost;
  if (hostUri) return `http://${hostUri.split(":")[0]}:4000`;
  return "http://localhost:4000";
}

export const API_URL = resolveBaseUrl();

export function mediaUrl(path: string): string;
export function mediaUrl(path?: string | null): string | undefined;
export function mediaUrl(path?: string | null) {
  if (!path) return undefined;
  return /^(https?|blob|data|file):/.test(path) ? path : `${API_URL}${path}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isForbiddenRole(err: unknown) {
  return err instanceof ApiError && err.code === "forbidden_role";
}

const FORBIDDEN_ROLE_MESSAGE = "Your role in this family doesn't allow that. An owner can change it in Family Hub.";

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

export function isNotFound(err: unknown) {
  return err instanceof ApiError && err.status === 404;
}

let unauthorizedHandler: () => void = () => void auth.signOut();

export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

let familyLostHandler: (familyId: string) => void = () => undefined;

export function onFamilyLost(handler: (familyId: string) => void) {
  familyLostHandler = handler;
}

// Between server-side account deletion and sign-out the token is still valid, and any
// request with it would recreate the account, so requests are held instead.
let held: Promise<never> | null = null;

export function holdRequests(hold: boolean) {
  held = hold ? new Promise<never>(() => undefined) : null;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  familyId: string | null = getFamilyId(),
): Promise<Response> {
  if (held) return held;
  const token = await auth.getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (familyId) headers.set("x-family-id", familyId);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && token) unauthorizedHandler();
  if (res.status === 403 && familyId && (await isFamilyRefusal(res))) familyLostHandler(familyId);
  return res;
}

async function isFamilyRefusal(res: Response) {
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    return false;
  }
  return Boolean(body && typeof body === "object" && "error" in body && body.error === "forbidden");
}

export async function apiGet<T>(path: string, familyId?: string | null): Promise<T> {
  const res = await apiFetch(path, {}, familyId);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

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

export type UploadLimits = { maxUploadBytes: number };

// Decimal units, the way phones and file browsers report sizes.
export function tooLargeMessage(mime: string, maxUploadBytes: number) {
  const size =
    maxUploadBytes >= 1e9
      ? `${Math.floor(maxUploadBytes / 1e9)} GB`
      : `${Math.floor(maxUploadBytes / 1e6)} MB`;
  return mime.startsWith("video/")
    ? `Videos over ${size} can't be added yet — try a shorter clip.`
    : `Files over ${size} can't be added yet.`;
}

export type UploadTarget = {
  url: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresAt?: string;
};

export type UploadInit = { uploadId?: string; key: string; target: UploadTarget };

export type FinalizedMedia = {
  key: string;
  type: "PHOTO" | "VIDEO" | "AUDIO";
  mimeType: string;
  bytes: number;
  sha256?: string | null;
  checksum?: string | null;
  width?: number;
  height?: number;
};

// The PUT goes to S3/Mux, not this API: S3 signs `target.headers` into the URL, so send
// exactly those. Web fetch has no upload progress events, so onProgress only reports on native.
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
    if (res.status === 413) {
      const body: Partial<UploadLimits> | null = await res.json().catch(() => null);
      if (body?.maxUploadBytes) throw new Error(tooLargeMessage(type, body.maxUploadBytes));
    }
    if (!res.ok) throw await errorFrom(res);
    return res.json();
  };

  if (Platform.OS === "web") {
    // Fetching the blob:/data: URI gives the exact byte length init must authorise.
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

  // Streams from disk so a large video is never held in JS memory.
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

export async function uploadAssets(assets: DraftAsset[], onProgress?: (text: string) => void) {
  const media = [];
  for (const [i, asset] of assets.entries()) {
    const label = assets.length > 1 ? `${i + 1} of ${assets.length}` : "";
    onProgress?.(label ? `Uploading ${label}…` : "Uploading…");
    const uploaded = await uploadFile(asset.uri, asset.name, asset.mime, (fraction) =>
      onProgress?.(`Uploading ${label} ${Math.round(fraction * 100)}%`.replace(/\s+/g, " ").trim()),
    );
    const audio = uploaded.type === "AUDIO";
    const timed = audio || uploaded.type === "VIDEO";
    media.push({
      type: uploaded.type,
      storageKey: uploaded.key,
      mimeType: uploaded.mimeType,
      bytes: uploaded.bytes,
      ...(uploaded.checksum ? { checksum: uploaded.checksum } : {}),
      ...(uploaded.sha256 ? { sha256: uploaded.sha256 } : {}),
      ...(timed && asset.durationS && asset.durationS > 0 ? { durationS: Math.round(asset.durationS) } : {}),
      ...(audio
        ? {}
        : {
            width: uploaded.width ?? asset.width ?? 1200,
            height: uploaded.height ?? asset.height ?? 900,
          }),
    });
  }
  return media;
}

export async function addToMemory(memoryId: string, assets: DraftAsset[], onProgress?: (text: string) => void) {
  onProgress?.("Uploading…");
  await apiGet(`/api/memories/${memoryId}`);
  const media = await uploadAssets(assets, onProgress);
  onProgress?.("Adding…");
  return apiSend<{ memory: Memory }>(`/api/memories/${memoryId}/media`, "POST", { media });
}

async function finalizeUpload(key: string) {
  const { media } = await apiSend<{ media: FinalizedMedia }>("/api/media/finalize", "POST", { key });
  return media;
}

export type MembershipRole = "OWNER" | "CONTRIBUTOR" | "VIEWER";

export type Membership = {
  familyId: string;
  familyName: string;
  role: MembershipRole;
  personId: string | null;
};

export type MePayload = {
  user: { id: string; email: string; displayName: string; emailVerified: boolean; createdAt: string };
  memberships: Membership[];
};

export type DeletionPreview = {
  allowed: boolean;
  reason?: "not_an_owner";
  deletes: { familyId: string; name: string; members: number; memories: number }[];
  leaves: { familyId: string; name: string }[];
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
  heroUrl: string;
  thumbUrl?: string;
  excerpt: string | null;
  mediaCount: number;
  hasAudio: boolean;
  paletteHue: number;
  brightness: number;
  participants: Person[];
  mediaTypes: MediaType[];
  isTextOnly: boolean;
};

export type MediaType = "PHOTO" | "VIDEO" | "AUDIO";

export type TranscriptStatus = "PENDING" | "READY" | "FAILED";

export type MediaStatus = "PROCESSING" | "READY" | "FAILED";

export type MediaItem = {
  id: string;
  type: MediaType;
  url: string | null;
  thumbUrl?: string | null;
  /** May be a HEIC a browser can't draw. */
  originalUrl?: string | null;
  status?: MediaStatus | null;
  posterUrl?: string | null;
  caption: string | null;
  width: number;
  height: number;
  durationS: number | null;
  isOriginal: boolean;
  transcriptStatus: TranscriptStatus | null;
  transcript: string | null;
};

export function mediaStatus(item: Pick<MediaItem, "type" | "status" | "url">): MediaStatus {
  if (item.type === "PHOTO") return "READY";
  return item.status ?? (item.url ? "READY" : "PROCESSING");
}

export type DownloadFile = {
  mediaId: string;
  type: MediaType;
  filename: string;
  status: "ready" | "preparing" | "failed";
  url?: string;
  expiresAt?: string;
};

export type DownloadsPayload = {
  files: DownloadFile[];
  unavailable: number;
};

export type Memory = MemoryCard & {
  story: string | null;
  storySource: "HUMAN" | "AI_DRAFT";
  transcript: string | null;
  transcriptStatus: TranscriptStatus | null;
  createdAt: string;
  author: Person | null;
  media: MediaItem[];
  collections: MemoryCollection[];
  isFavorite: boolean;
  related: MemoryCard[];
  linkedIds: string[];
};

export type MemoryCollection = {
  id: string;
  name: string;
  parentName: string | null;
  birthday: number | null;
  pillar: PillarKey;
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
  kind: CollectionKind | null;
  icon: string;
  color: string;
  parentId: string | null;
  parentName: string | null;
  birthday: number | null;
};

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
  prompt: { id: string; text: string; subtitle: string | null; imageUrl: string };
  storySoFar: MemoryCard[];
  updates: {
    id: string;
    kind: string;
    message: string;
    actor: Person | null;
    createdAt: string;
  }[];
  stats: { memoryCount: number; personCount: number };
  gettingStarted: {
    firstMemory: boolean;
    addedSomeone: boolean;
    addedChild: boolean;
    invitedSomeone: boolean;
  };
};

export type LibraryPillar = {
  key: PillarKey;
  name: string;
  tagline: string;
  coverUrl: string;
  customCover: boolean;
};

export type LibraryPayload = { pillars: LibraryPillar[] };

export type ChildSummary = Person & {
  photoUrl: string | null;
  photoThumbUrl: string | null;
  collectionCount: number;
  memoryCount: number;
};

export type ChildrenPayload = { children: ChildSummary[] };

export type ChildPayload = { child: ChildSummary; collections: Collection[] };

export type CollectionArchivePayload = {
  collection: Collection;
  child: ChildSummary | null;
  years: { year: number; count: number }[];
  memories: MemoryCard[];
};

export type BirthdaysPayload = {
  collection: Collection;
  child: ChildSummary | null;
  birthdays: { collection: Collection; memoryCount: number; coverUrl: string | null }[];
  unsortedCount: number;
};

export type CategoryTile = {
  memoryCount: number;
  thumbUrl: string | null;
  preview: string | null;
  mediaTypes: MediaType[];
};

export type BirthdayPayload = {
  birthday: Collection & { birthday: number };
  birthdays: Collection;
  child: ChildSummary | null;
  categories: (CategoryTile & { collection: Collection })[];
  otherMoments: CategoryTile | null;
};

export type PersonPatch = {
  name?: string;
  relation?: string | null;
  birthDate?: string | null;
  photoKey?: string | null;
};

export type PersonCreate = { name: string; role: Person["role"]; relation?: string; birthDate?: string };

export type PersonDetail = {
  person: Person;
  isMember: boolean;
  memoryCount: number;
  memories: MemoryCard[];
  collections: { id: string; name: string; pillar: PillarKey }[];
};

export type CollectionCreate = {
  pillar: PillarKey;
  name: string;
  description?: string | null;
  personId?: string | null;
  icon: string;
  color: string;
};

export type CollectionPatch = { name?: string; description?: string | null; icon?: string; color?: string };

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
  isTextOnly: boolean;
  excerpt: string | null;
  paletteHue: number;
  palette?: string[];
  span: "single" | "wide" | "tall";
};

export type FamilyMember = {
  userId: string;
  role: MembershipRole;
  permission: string;
  name: string;
  email: string | null;
  isYou: boolean;
  person: Person | null;
  joinedAt: string;
};

export type FamilyPerson = Person & {
  invitable: boolean;
};

export type FamilyPayload = {
  family: { id: string; name: string; createdAt: string };
  role: MembershipRole;
  members: FamilyMember[];
  people: FamilyPerson[];
  stats: { memoryCount: number; mediaCount: number; collectionCount: number; personCount: number };
  subscription: { plan: string; status: string };
};

export type InviteStatus = "valid" | "expired" | "used" | "revoked";

export type Invite = {
  id: string;
  role: MembershipRole;
  email: string | null;
  personId: string | null;
  forName: string | null;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
  url: string;
};

export type InviteCreate = {
  role: MembershipRole;
  email?: string;
  personId?: string;
  name?: string;
};

export type InvitePreview = {
  familyName: string;
  inviterName: string;
  role: MembershipRole;
  forName: string | null;
  status: InviteStatus;
  expiresAt: string;
};

export type AcceptedInvite = { membership: Membership };
