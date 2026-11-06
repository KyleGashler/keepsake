import { Prisma, type Collection, type Person } from "@prisma/client";
import { memoryTextMatch } from "./archive.js";
import { prisma } from "./prisma.js";
import {
  collectionDto,
  collectionInclude,
  heroStill,
  MEDIA_TYPE_ORDER,
  mediaInclude,
  storyExcerpt,
  type MediaRow,
} from "./serialize.js";

export const SUGGESTED_CATEGORIES = ["Friend Party", "Family Birthday Dinner", "Lunch with Grandma"] as const;

export const MAX_BIRTHDAY = 120;

export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

export function nearestBirthday(birthDate: Date, at: Date): number | null {
  const anniversary = (n: number) =>
    Date.UTC(birthDate.getUTCFullYear() + n, birthDate.getUTCMonth(), birthDate.getUTCDate());
  let n = at.getUTCFullYear() - birthDate.getUTCFullYear();
  if (anniversary(n) > at.getTime()) n -= 1;
  if (at.getTime() - anniversary(n) > anniversary(n + 1) - at.getTime()) n += 1;
  return n >= 1 ? n : null;
}

type BirthdaysCollection = Collection & { person: Person | null };

export function findBirthdays(familyId: string, id: string) {
  return prisma.collection.findFirst({
    where: { id, familyId, kind: "birthdays" },
    include: collectionInclude,
  });
}

export async function findBirthday(familyId: string, id: string) {
  const birthday = await prisma.collection.findFirst({
    where: { id, familyId, birthday: { not: null }, parent: { kind: "birthdays" } },
    include: { ...collectionInclude, parent: { include: collectionInclude } },
  });
  return birthday?.parent ? { ...birthday, parent: birthday.parent } : null;
}

type Birthday = NonNullable<Awaited<ReturnType<typeof findBirthday>>>;

function memoriesWhere(where: Prisma.MemoryWhereInput, media: "all" | "pictures" = "all") {
  return prisma.memory.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: {
      media: media === "all" ? mediaInclude : { ...mediaInclude, where: { type: { in: ["PHOTO", "VIDEO"] } } },
      collections: { select: { collectionId: true } },
    },
  });
}

type FiledMemory = Awaited<ReturnType<typeof memoriesWhere>>[number];

const filedIn = (m: FiledMemory, ids: Set<string>) => m.collections.some((c) => ids.has(c.collectionId));

function birthdayOf(birthdays: BirthdaysCollection, m: { occurredAt: Date }) {
  return birthdays.person?.birthDate ? nearestBirthday(birthdays.person.birthDate, m.occurredAt) : null;
}

export async function looseMemoryIds(familyId: string, birthdays: BirthdaysCollection, which: number | "unsorted") {
  const [added, loose] = await Promise.all([
    prisma.collection.findMany({ where: { parentId: birthdays.id }, select: { birthday: true } }),
    prisma.memory.findMany({
      where: { familyId, collections: { some: { collectionId: birthdays.id } } },
      select: { id: true, occurredAt: true },
    }),
  ]);
  const taken = new Set(added.map((a) => a.birthday));
  const belongs = (n: number | null) => (which === "unsorted" ? !taken.has(n) : n === which);
  return loose.filter((m) => belongs(birthdayOf(birthdays, m))).map((m) => m.id);
}

async function firstPicture(memories: { media: MediaRow[] }[], size: "THUMB" | "DISPLAY") {
  for (const m of memories) {
    const hero = await heroStill(m.media, size);
    if (hero) return hero.url;
  }
  return null;
}

function filedUnderBirthdays(birthdaysId: string): Prisma.MemoryCollectionListRelationFilter {
  return { some: { collection: { OR: [{ id: birthdaysId }, { parent: { parentId: birthdaysId } }] } } };
}

export function birthdaysMemoryCount(familyId: string, birthdaysId: string) {
  return prisma.memory.count({ where: { familyId, collections: filedUnderBirthdays(birthdaysId) } });
}

export async function birthdayGrid(familyId: string, birthdays: BirthdaysCollection) {
  const [rows, memories] = await Promise.all([
    prisma.collection.findMany({
      where: { parentId: birthdays.id },
      orderBy: { birthday: "asc" },
      include: { children: { select: { id: true } } },
    }),
    memoriesWhere({ familyId, collections: filedUnderBirthdays(birthdays.id) }, "pictures"),
  ]);

  const loose = new Set([birthdays.id]);
  const nearest = new Map(memories.filter((m) => filedIn(m, loose)).map((m) => [m.id, birthdayOf(birthdays, m)]));
  const added = new Set(rows.map((r) => r.birthday));

  const tiles = await Promise.all(
    rows.map(async (r) => {
      const categories = new Set(r.children.map((c) => c.id));
      const mine = memories.filter((m) => filedIn(m, categories) || nearest.get(m.id) === r.birthday);
      return {
        collection: collectionDto(r),
        memoryCount: mine.length,
        coverUrl: await firstPicture(mine, "DISPLAY"),
      };
    }),
  );
  const unsortedCount = [...nearest.values()].filter((n) => !added.has(n)).length;
  return { birthdays: tiles, unsortedCount };
}

async function categoryTile(memories: FiledMemory[]) {
  const newest = memories[0];
  return {
    memoryCount: memories.length,
    thumbUrl: await firstPicture(memories, "THUMB"),
    preview: newest ? (storyExcerpt(newest.story) ?? newest.title) : null,
    mediaTypes: MEDIA_TYPE_ORDER.filter((t) => memories.some((m) => m.media.some((x) => x.type === t))),
  };
}

export async function birthdayCategories(familyId: string, birthday: Birthday, q?: string) {
  const [categories, filed, loose] = await Promise.all([
    prisma.collection.findMany({
      where: { parentId: birthday.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: collectionInclude,
    }),
    memoriesWhere({ familyId, collections: { some: { collection: { parentId: birthday.id } } }, ...memoryTextMatch(q) }),
    memoriesWhere({ familyId, collections: { some: { collectionId: birthday.parent.id } }, ...memoryTextMatch(q) }),
  ]);
  const near = loose.filter((m) => birthdayOf(birthday.parent, m) === birthday.birthday);

  const tiles = await Promise.all(
    categories.map(async (c) => {
      const mine = filed.filter((m) => m.collections.some((x) => x.collectionId === c.id));
      return { collection: collectionDto(c), ...(await categoryTile(mine)) };
    }),
  );
  return {
    categories: q ? tiles.filter((t) => t.memoryCount > 0) : tiles,
    otherMoments: near.length ? await categoryTile(near) : null,
  };
}

export async function addBirthday(birthdays: Collection, n: number) {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.collection.create({
        data: {
          familyId: birthdays.familyId,
          pillar: birthdays.pillar,
          personId: birthdays.personId,
          parentId: birthdays.id,
          birthday: n,
          name: `${ordinal(n)} Birthday`,
          icon: birthdays.icon,
          color: birthdays.color,
          isDefault: false,
          sortOrder: n,
          coverSeed: `birthday-${birthdays.id}-${n}`,
        },
      });
      await tx.collection.createMany({
        data: SUGGESTED_CATEGORIES.map((name, sortOrder) => categoryRow(created, name, sortOrder)),
      });
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

function categoryRow(birthday: Collection, name: string, sortOrder: number): Prisma.CollectionCreateManyInput {
  return {
    familyId: birthday.familyId,
    pillar: birthday.pillar,
    personId: birthday.personId,
    parentId: birthday.id,
    name,
    icon: birthday.icon,
    color: birthday.color,
    isDefault: false,
    sortOrder,
    coverSeed: `birthday-category-${birthday.id}-${sortOrder}-${Date.now()}`,
  };
}

export async function addCategory(birthday: Collection, name: string) {
  const last = await prisma.collection.aggregate({ where: { parentId: birthday.id }, _max: { sortOrder: true } });
  return prisma.collection.create({
    data: categoryRow(birthday, name, (last._max.sortOrder ?? -1) + 1),
    include: collectionInclude,
  });
}

export async function reorderCategories(birthday: Collection, ids: string[]) {
  const current = await prisma.collection.findMany({ where: { parentId: birthday.id }, select: { id: true } });
  const wanted = new Set(ids);
  if (wanted.size !== ids.length || current.length !== ids.length || current.some((c) => !wanted.has(c.id))) {
    return false;
  }
  await prisma.$transaction(ids.map((id, sortOrder) => prisma.collection.update({ where: { id }, data: { sortOrder } })));
  return true;
}
