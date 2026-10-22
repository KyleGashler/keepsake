import { RENDER_VERSION } from "./placeholder.js";
import { READ_URL_TTL_SECONDS, storage } from "../storage/index.js";
import { mediaHost } from "../media-host/index.js";
import type {
  Collection,
  Media,
  MediaStatus,
  MediaType,
  Memory,
  MuxAsset,
  Person,
  TranscriptStatus,
} from "@prisma/client";

/**
 * Load Media with this so the DTOs can sign a clip's URLs: `media: mediaInclude`.
 * The types below require it, so a query that forgets won't compile.
 */
export const mediaInclude = { include: { muxAsset: true } } as const;

/** A Media row with its Mux asset (null for photos, placeholders, pre-Mux rows). */
export type MediaRow = Media & { muxAsset: MuxAsset | null };

/**
 * Placeholder media is generated on demand; uploads are served from disk.
 *
 * `v` is the renderer's fingerprint, so changing the palette changes every URL
 * and clients don't sit on a year of cached old colours.
 */
export function imageUrl(seed: string, w: number, h: number, baseColor?: string | null) {
  const base = baseColor ? `&c=${encodeURIComponent(baseColor)}` : "";
  return withVersion(`/media/gen/${encodeURIComponent(seed)}.png?w=${w}&h=${h}${base}`);
}

/**
 * Stamp the renderer's fingerprint onto a generated-media path.
 *
 * Media rows store the path without one, deliberately — a fingerprint in the
 * database would be a snapshot of whatever the palette looked like at seed time,
 * and would go stale the moment it changed. Stamping on the way out means a
 * palette change reaches every client on the next response, no reseed needed.
 * Uploads are left alone; they're real files and their bytes never change.
 */
export function withVersion(url: string) {
  if (!url.startsWith("/media/gen/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${RENDER_VERSION}`;
}

export function personDto(p: Person) {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    relation: p.relation,
    birthDate: p.birthDate?.toISOString() ?? null,
    accentColor: p.accentColor,
    // An avatar takes the person's own palette colour, so the orb and the ring
    // drawn around it are the same hue.
    avatarUrl: imageUrl(p.avatarSeed, 240, 240, p.accentColor),
    initials: p.name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  };
}

/**
 * Where a Media row is actually readable from.
 *
 * A row with a `storageKey` is a real upload, and its URL is minted by the
 * storage provider fresh on every response — presigned URLs expire, so a URL is
 * never something to persist. Rows without one are the generated placeholders
 * (and pre-A5 demo uploads), whose `url` column is the answer.
 *
 * This is why the DTO functions below are async. S3's `getSignedUrl` returns a
 * promise, so `StorageProvider.getReadUrl` has to; a sync path that only the
 * local provider could satisfy would be torn out again the day B2 lands.
 */
export async function mediaReadUrl(m: Pick<Media, "url" | "storageKey">) {
  if (m.storageKey) return storage().getReadUrl(m.storageKey, READ_URL_TTL_SECONDS);
  return withVersion(m.url);
}

/**
 * A clip on Mux, as the client sees it: PROCESSING until the asset plays,
 * then its signed URLs. `url` is HLS for video and the `audio.m4a` rendition
 * for audio (HLS if Mux couldn't make the rendition); `posterUrl` is a signed
 * frame, video only. Both null until READY, and null when the server has no
 * Mux signing key to sign them with.
 */
async function muxMedia(m: MediaRow, asset: MuxAsset) {
  const status: MediaStatus = asset.status === "READY" || asset.status === "FAILED" ? asset.status : "PROCESSING";
  const host = mediaHost();
  if (status !== "READY" || !host || !asset.playbackId) return { status, url: null, posterUrl: null };
  const kind = m.type === "AUDIO" && asset.renditionStatus === "ready" ? "audio" : "hls";
  const [url, posterUrl] = await Promise.all([
    host.playbackUrl(asset.playbackId, kind, asset.durationS),
    m.type === "VIDEO" ? host.posterUrl(asset.playbackId, asset.durationS) : null,
  ]);
  return { status, url, posterUrl };
}

/**
 * The still that stands for a PHOTO or VIDEO in a card or tile: the photo
 * itself, or a video's poster frame — never the video. A clip still
 * processing gets its poster URL as soon as Mux has a playback id: it fails
 * to load until Mux has a frame, and the client draws its own tile behind
 * it meanwhile. Null when there's no still to give.
 */
export async function stillUrl(m: MediaRow): Promise<string | null> {
  if (m.type === "PHOTO") return mediaReadUrl(m);
  if (m.type !== "VIDEO" || !m.muxAsset?.playbackId || m.muxAsset.status === "FAILED") return null;
  return mediaHost()?.posterUrl(m.muxAsset.playbackId, m.muxAsset.durationS) ?? null;
}

/**
 * A memory's hero: the first PHOTO or VIDEO with a still, in the order
 * given. Null when none has one.
 */
export async function heroStill(media: MediaRow[]): Promise<{ url: string; media: MediaRow } | null> {
  for (const m of media) {
    if (m.type !== "PHOTO" && m.type !== "VIDEO") continue;
    const url = await stillUrl(m);
    if (url) return { url, media: m };
  }
  return null;
}

export async function mediaDto(m: MediaRow) {
  const av = m.muxAsset
    ? await muxMedia(m, m.muxAsset)
    : { status: m.status, url: await mediaReadUrl(m), posterUrl: null };
  return {
    id: m.id,
    type: m.type,
    /** PROCESSING | READY | FAILED. Photos and placeholders are READY. */
    status: av.status,
    /** Null while a clip is PROCESSING or FAILED. */
    url: av.url,
    /** A video's signed poster frame; null for everything else. */
    posterUrl: av.posterUrl,
    caption: m.caption,
    width: m.width,
    height: m.height,
    durationS: m.durationS,
    isOriginal: m.isOriginal,
    /** Null for media transcription doesn't apply to (photos, placeholders). */
    transcriptStatus: m.transcriptStatus,
    /** The machine transcript of this clip. The editable one is `memory.transcript`. */
    transcript: m.transcript,
  };
}

/**
 * One status for the whole memory: PENDING while any clip is still being
 * transcribed, else FAILED if any clip failed, else READY if any clip was
 * transcribed, else null (nothing to transcribe).
 */
export function aggregateTranscriptStatus(
  media: Pick<Media, "transcriptStatus" | "deletedAt">[],
): TranscriptStatus | null {
  const statuses = new Set(media.filter((x) => !x.deletedAt).map((x) => x.transcriptStatus));
  if (statuses.has("PENDING")) return "PENDING";
  if (statuses.has("FAILED")) return "FAILED";
  if (statuses.has("READY")) return "READY";
  return null;
}

/**
 * What `collectionDto` wants loaded: the owner, and a memory count that skips
 * soft-deleted memories. Use this rather than `_count: { memories: true }`.
 */
export const collectionInclude = {
  _count: { select: { memories: { where: { memory: { deletedAt: null } } } } },
  person: true,
} as const;

export function collectionDto(c: Collection & { _count?: { memories: number }; person?: Person | null }) {
  return {
    id: c.id,
    pillar: c.pillar,
    name: c.name,
    description: c.description,
    /** Template key of a child's default collection; null for a family's own. */
    kind: c.kind,
    /** Glyph key (see lib/child-collections.ts#COLLECTION_ICONS) and disc hex. */
    icon: c.icon,
    color: c.color,
    personId: c.personId,
    personName: c.person?.name ?? null,
    isDefault: c.isDefault,
    sortOrder: c.sortOrder,
    coverUrl: imageUrl(c.coverSeed, 800, 600),
    memoryCount: c._count?.memories ?? 0,
  };
}

type MemoryWithRelations = Memory & {
  media?: MediaRow[];
  author?: Person | null;
  participants?: { person: Person }[];
  collections?: { collection: Collection }[];
};

const MEDIA_TYPE_ORDER: MediaType[] = ["PHOTO", "VIDEO", "AUDIO"];

export async function memoryCardDto(m: MemoryWithRelations) {
  const media = m.media?.filter((x) => !x.deletedAt) ?? [];
  const hero = await heroStill(media);
  return {
    id: m.id,
    title: m.title,
    occurredAt: m.occurredAt.toISOString(),
    location: m.location,
    // A photo, or a video's poster frame (never the video itself); the
    // generated stand-in when there's neither.
    heroUrl: hero?.url ?? imageUrl(m.heroSeed, 1200, 900),
    excerpt: m.story ? m.story.replace(/\s+/g, " ").slice(0, 140) : null,
    mediaCount: media.length,
    hasAudio: media.some((x) => x.type === "AUDIO"),
    /** Which kinds of media it holds, in PHOTO, VIDEO, AUDIO order. */
    mediaTypes: MEDIA_TYPE_ORDER.filter((t) => media.some((x) => x.type === t)),
    /** No media at all: `heroUrl` is only a generated stand-in. */
    isTextOnly: media.length === 0,
    paletteHue: m.paletteHue,
    brightness: m.brightness,
    participants: m.participants?.map((p) => personDto(p.person)) ?? [],
  };
}

/**
 * Same as `memoryCardDto`, but overrides `excerpt` with a caller-supplied
 * string when one is given (falls back to the story lead-in otherwise).
 * Used by search to show a `ts_headline` snippet of the matched terms
 * instead of the plain start of the story.
 */
export async function memoryCardDtoWithExcerpt(m: MemoryWithRelations, excerpt: string | null | undefined) {
  const card = await memoryCardDto(m);
  return excerpt ? { ...card, excerpt } : card;
}

/** A list means N independent URL signings; run them together, not in sequence. */
export function memoryCardDtos(memories: MemoryWithRelations[]) {
  return Promise.all(memories.map((m) => memoryCardDto(m)));
}

export async function memoryDto(m: MemoryWithRelations) {
  return {
    ...(await memoryCardDto(m)),
    story: m.story,
    transcript: m.transcript,
    transcriptStatus: aggregateTranscriptStatus(m.media ?? []),
    createdAt: m.createdAt.toISOString(),
    author: m.author ? personDto(m.author) : null,
    media: await Promise.all(m.media?.filter((x) => !x.deletedAt).map(mediaDto) ?? []),
    collections:
      m.collections?.map((mc) => ({
        id: mc.collection.id,
        name: mc.collection.name,
        pillar: mc.collection.pillar,
        personId: mc.collection.personId,
        kind: mc.collection.kind,
        icon: mc.collection.icon,
        color: mc.collection.color,
      })) ?? [],
  };
}
