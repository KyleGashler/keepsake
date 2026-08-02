import type { Collection, Media, Memory, Person } from "@prisma/client";

/** Placeholder media is generated on demand; uploads are served from disk. */
export function imageUrl(seed: string, w: number, h: number) {
  return `/media/gen/${encodeURIComponent(seed)}.png?w=${w}&h=${h}`;
}

export function personDto(p: Person) {
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    relation: p.relation,
    birthDate: p.birthDate?.toISOString() ?? null,
    accentColor: p.accentColor,
    avatarUrl: imageUrl(p.avatarSeed, 240, 240),
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
    url: m.url,
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
    heroUrl: hero?.url ?? imageUrl(m.heroSeed, 1200, 900),
    excerpt: m.story ? m.story.replace(/\s+/g, " ").slice(0, 140) : null,
    mediaCount: m.media?.length ?? 0,
    hasAudio: m.media?.some((x) => x.type === "AUDIO") ?? false,
    paletteHue: m.paletteHue,
    brightness: m.brightness,
    participants: m.participants?.map((p) => personDto(p.person)) ?? [],
  };
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
