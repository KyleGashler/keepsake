import { pictureUrl } from "./pictures.js";
import { RENDER_VERSION } from "./placeholder.js";
import { READ_URL_TTL_SECONDS, storage, type PhotoDerivativeKind } from "../storage/index.js";
import { mediaHost } from "../media-host/index.js";
import type {
  Prisma,
  Collection,
  Derivative,
  Media,
  MediaStatus,
  MediaType,
  Memory,
  MuxAsset,
  Person,
  TranscriptStatus,
} from "@prisma/client";

export const MEDIA_ORDER: Prisma.MediaOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "asc" }];

export const mediaInclude = {
  include: { muxAsset: true, derivatives: { select: { kind: true, storageKey: true } } },
  orderBy: MEDIA_ORDER,
} as const;

export type MediaRow = Media & {
  muxAsset: MuxAsset | null;
  derivatives: Pick<Derivative, "kind" | "storageKey">[];
};

export function canBeHero(m: { type: MediaType; muxAsset: Pick<MuxAsset, "playbackId" | "status"> | null }) {
  if (m.type === "PHOTO") return true;
  return m.type === "VIDEO" && Boolean(m.muxAsset?.playbackId) && m.muxAsset?.status !== "FAILED";
}

export function imageUrl(seed: string, w: number, h: number, baseColor?: string | null) {
  const base = baseColor ? `&c=${encodeURIComponent(baseColor)}` : "";
  return withVersion(`/media/gen/${encodeURIComponent(seed)}.png?w=${w}&h=${h}${base}`);
}

// Stamped on the way out rather than stored, so a palette change busts every
// client's cache with no reseed.
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
    avatarUrl: imageUrl(p.avatarSeed, 240, 240, p.accentColor),
    initials: p.name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  };
}

// Presigned URLs expire, so an upload's URL is minted per response, never stored.
export async function mediaReadUrl(m: Pick<Media, "url" | "storageKey">) {
  if (m.storageKey) return storage().getReadUrl(m.storageKey, READ_URL_TTL_SECONDS);
  return withVersion(m.url);
}

export async function photoUrl(m: Pick<MediaRow, "url" | "storageKey" | "derivatives">, kind: PhotoDerivativeKind) {
  return (await pictureUrl(m, kind)) ?? withVersion(m.url);
}

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

// A processing clip's poster fails to load until Mux has a frame; the client
// draws its own tile behind it.
export async function stillUrl(m: MediaRow, kind: PhotoDerivativeKind = "DISPLAY"): Promise<string | null> {
  if (m.type === "PHOTO") return photoUrl(m, kind);
  if (!canBeHero(m) || !m.muxAsset?.playbackId) return null;
  return mediaHost()?.posterUrl(m.muxAsset.playbackId, m.muxAsset.durationS) ?? null;
}

export async function heroStill(
  media: MediaRow[],
  kind: PhotoDerivativeKind = "DISPLAY",
): Promise<{ url: string; media: MediaRow } | null> {
  for (const m of media) {
    if (m.type !== "PHOTO" && m.type !== "VIDEO") continue;
    const url = await stillUrl(m, kind);
    if (url) return { url, media: m };
  }
  return null;
}

export async function mediaDto(m: MediaRow) {
  const photo = !m.muxAsset && m.type === "PHOTO";
  const av = m.muxAsset
    ? await muxMedia(m, m.muxAsset)
    : { status: m.status, url: photo ? await photoUrl(m, "DISPLAY") : await mediaReadUrl(m), posterUrl: null };
  return {
    id: m.id,
    type: m.type,
    status: av.status,
    url: av.url,
    thumbUrl: photo ? await photoUrl(m, "THUMB") : av.posterUrl,
    originalUrl: photo ? await mediaReadUrl(m) : null,
    posterUrl: av.posterUrl,
    caption: m.caption,
    width: m.width,
    height: m.height,
    durationS: m.durationS,
    isOriginal: m.isOriginal,
    transcriptStatus: m.transcriptStatus,
    transcript: m.transcript,
  };
}

export function aggregateTranscriptStatus(media: Pick<Media, "transcriptStatus">[]): TranscriptStatus | null {
  const statuses = new Set(media.map((x) => x.transcriptStatus));
  if (statuses.has("PENDING")) return "PENDING";
  if (statuses.has("FAILED")) return "FAILED";
  if (statuses.has("READY")) return "READY";
  return null;
}

export const collectionInclude = {
  _count: { select: { memories: true } },
  person: true,
  parent: { select: { name: true } },
} as const;

export function collectionDto(
  c: Collection & { _count?: { memories: number }; person?: Person | null; parent?: { name: string } | null },
) {
  return {
    id: c.id,
    pillar: c.pillar,
    name: c.name,
    description: c.description,
    kind: c.kind,
    icon: c.icon,
    color: c.color,
    personId: c.personId,
    personName: c.person?.name ?? null,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    birthday: c.birthday,
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
  collections?: { collection: Collection & { parent?: { name: string } | null } }[];
};

export const MEDIA_TYPE_ORDER: MediaType[] = ["PHOTO", "VIDEO", "AUDIO"];

export function storyExcerpt(story: string | null) {
  return story ? story.replace(/\s+/g, " ").slice(0, 140) : null;
}

export async function memoryCardDto(m: MemoryWithRelations) {
  const media = m.media ?? [];
  const hero = await heroStill(media, "DISPLAY");
  const heroUrl = hero?.url ?? imageUrl(m.heroSeed, 1200, 900);
  return {
    id: m.id,
    title: m.title,
    occurredAt: m.occurredAt.toISOString(),
    location: m.location,
    heroUrl,
    thumbUrl: hero ? ((await stillUrl(hero.media, "THUMB")) ?? heroUrl) : imageUrl(m.heroSeed, 400, 300),
    excerpt: storyExcerpt(m.story),
    mediaCount: media.length,
    hasAudio: media.some((x) => x.type === "AUDIO"),
    mediaTypes: MEDIA_TYPE_ORDER.filter((t) => media.some((x) => x.type === t)),
    isTextOnly: media.length === 0,
    paletteHue: m.paletteHue,
    brightness: m.brightness,
    participants: m.participants?.map((p) => personDto(p.person)) ?? [],
  };
}

export async function memoryCardDtoWithExcerpt(m: MemoryWithRelations, excerpt: string | null | undefined) {
  const card = await memoryCardDto(m);
  return excerpt ? { ...card, excerpt } : card;
}

export function memoryCardDtos(memories: MemoryWithRelations[]) {
  return Promise.all(memories.map((m) => memoryCardDto(m)));
}

export async function memoryDto(m: MemoryWithRelations) {
  return {
    ...(await memoryCardDto(m)),
    story: m.story,
    storySource: m.storySource,
    transcript: m.transcript,
    transcriptStatus: aggregateTranscriptStatus(m.media ?? []),
    createdAt: m.createdAt.toISOString(),
    author: m.author ? personDto(m.author) : null,
    media: await Promise.all(m.media?.map(mediaDto) ?? []),
    collections:
      m.collections?.map((mc) => ({
        id: mc.collection.id,
        name: mc.collection.name,
        pillar: mc.collection.pillar,
        personId: mc.collection.personId,
        parentName: mc.collection.parent?.name ?? null,
        birthday: mc.collection.birthday,
        kind: mc.collection.kind,
        icon: mc.collection.icon,
        color: mc.collection.color,
      })) ?? [],
  };
}
