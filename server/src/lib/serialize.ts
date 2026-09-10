import { RENDER_VERSION } from "./placeholder.js";
import type { Collection, Media, Memory, Person } from "@prisma/client";

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

export function mediaDto(m: Media) {
  return {
    id: m.id,
    type: m.type,
    url: withVersion(m.url),
    caption: m.caption,
    width: m.width,
    height: m.height,
    durationS: m.durationS,
    isOriginal: m.isOriginal,
  };
}

export function collectionDto(c: Collection & { _count?: { memories: number }; person?: Person | null }) {
  return {
    id: c.id,
    pillar: c.pillar,
    name: c.name,
    description: c.description,
    personId: c.personId,
    personName: c.person?.name ?? null,
    isDefault: c.isDefault,
    sortOrder: c.sortOrder,
    coverUrl: imageUrl(c.coverSeed, 800, 600),
    memoryCount: c._count?.memories ?? 0,
  };
}

type MemoryWithRelations = Memory & {
  media?: Media[];
  author?: Person | null;
  participants?: { person: Person }[];
  collections?: { collection: Collection }[];
};

export function memoryCardDto(m: MemoryWithRelations) {
  const hero = m.media?.find((x) => x.type === "PHOTO" || x.type === "VIDEO");
  return {
    id: m.id,
    title: m.title,
    occurredAt: m.occurredAt.toISOString(),
    location: m.location,
    heroUrl: (hero ? withVersion(hero.url) : null) ?? imageUrl(m.heroSeed, 1200, 900),
    excerpt: m.story ? m.story.replace(/\s+/g, " ").slice(0, 140) : null,
    mediaCount: m.media?.length ?? 0,
    hasAudio: m.media?.some((x) => x.type === "AUDIO") ?? false,
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
export function memoryCardDtoWithExcerpt(m: MemoryWithRelations, excerpt: string | null | undefined) {
  const card = memoryCardDto(m);
  return excerpt ? { ...card, excerpt } : card;
}

export function memoryDto(m: MemoryWithRelations) {
  return {
    ...memoryCardDto(m),
    story: m.story,
    transcript: m.transcript,
    createdAt: m.createdAt.toISOString(),
    author: m.author ? personDto(m.author) : null,
    media: m.media?.map(mediaDto) ?? [],
    collections:
      m.collections?.map((mc) => ({
        id: mc.collection.id,
        name: mc.collection.name,
        pillar: mc.collection.pillar,
      })) ?? [],
  };
}
