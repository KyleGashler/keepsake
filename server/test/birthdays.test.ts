import { beforeEach, describe, expect, it } from "vitest";
import {
  addBirthday,
  addCategory,
  birthdayCategories,
  birthdayGrid,
  findBirthday,
  findBirthdays,
  looseMemoryIds,
  nearestBirthday,
  ordinal,
  reorderCategories,
} from "../src/lib/birthdays.js";
import { ensureChildCollections } from "../src/lib/child-collections.js";
import { prisma } from "../src/lib/prisma.js";

describe("nearestBirthday", () => {
  const born = new Date("2020-05-14T00:00:00Z");

  it("counts a party the weekend before as that birthday", () => {
    expect(nearestBirthday(born, new Date("2026-05-09T18:00:00Z"))).toBe(6);
    expect(nearestBirthday(born, new Date("2026-05-20T18:00:00Z"))).toBe(6);
  });

  it("switches at the half-year", () => {
    expect(nearestBirthday(born, new Date("2026-11-10T00:00:00Z"))).toBe(6);
    expect(nearestBirthday(born, new Date("2026-11-16T00:00:00Z"))).toBe(7);
  });

  it("has no birthday before the first", () => {
    expect(nearestBirthday(born, new Date("2020-09-01T00:00:00Z"))).toBeNull();
  });
});

it("ordinal", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th",
  ]);
});

let familyId = "";
let birthdaysId = "";

async function memory(title: string, occurredAt: string, collectionIds: string[], story?: string) {
  return prisma.memory.create({
    data: {
      familyId,
      title,
      story: story ?? null,
      occurredAt: new Date(occurredAt),
      heroSeed: title,
      collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
    },
  });
}

async function birthdays() {
  const found = await findBirthdays(familyId, birthdaysId);
  if (!found) throw new Error("no Birthdays");
  return found;
}

async function added(n: number) {
  const result = await addBirthday(await birthdays(), n);
  if (!result) throw new Error("not added");
  const birthday = await findBirthday(familyId, result.id);
  if (!birthday) throw new Error("not found");
  return birthday;
}

async function categoryId(birthdayId: string, name: string) {
  const c = await prisma.collection.findFirstOrThrow({ where: { parentId: birthdayId, name } });
  return c.id;
}

beforeEach(async () => {
  const family = await prisma.family.create({ data: { name: "Test family" } });
  familyId = family.id;
  const child = await prisma.person.create({
    data: { familyId, name: "Banks", role: "CHILD", birthDate: new Date("2020-05-14T00:00:00Z"), avatarSeed: "b" },
  });
  await ensureChildCollections(familyId, child.id);
  birthdaysId = (await prisma.collection.findFirstOrThrow({ where: { personId: child.id, kind: "birthdays" } })).id;
});

describe("addBirthday", () => {
  it("names it and gives it the suggested categories, once", async () => {
    const sixth = await added(6);
    expect(sixth.name).toBe("6th Birthday");
    const { categories } = await birthdayCategories(familyId, sixth);
    expect(categories.map((c) => c.collection.name)).toEqual([
      "Friend Party",
      "Family Birthday Dinner",
      "Lunch with Grandma",
    ]);
    expect(await addBirthday(await birthdays(), 6)).toBeNull();
  });
});

describe("birthdayGrid", () => {
  it("counts a birthday's categories and the loose memories nearest it", async () => {
    const sixth = await added(6);
    await added(2);
    const party = await categoryId(sixth.id, "Friend Party");
    const dinner = await categoryId(sixth.id, "Family Birthday Dinner");
    await memory("Party", "2026-05-16T12:00:00Z", [party, dinner]);
    await memory("Cake", "2026-05-14T12:00:00Z", [birthdaysId]);
    await memory("Fourth", "2024-05-14T12:00:00Z", [birthdaysId]);

    const grid = await birthdayGrid(familyId, await birthdays());
    expect(grid.birthdays.map((b) => [b.collection.birthday, b.memoryCount])).toEqual([
      [2, 0],
      [6, 2],
    ]);
    expect(grid.unsortedCount).toBe(1);
    expect(await looseMemoryIds(familyId, await birthdays(), "unsorted")).toHaveLength(1);
  });
});

describe("birthdayCategories", () => {
  it("previews the newest story and narrows to matching memories", async () => {
    const sixth = await added(6);
    const party = await categoryId(sixth.id, "Friend Party");
    await memory("Older", "2026-05-10T12:00:00Z", [party], "Balloons everywhere");
    await memory("Newer", "2026-05-16T12:00:00Z", [party], "So much laughter");
    await memory("Cake", "2026-05-14T12:00:00Z", [birthdaysId]);

    const all = await birthdayCategories(familyId, sixth);
    expect(all.categories[0]?.preview).toBe("So much laughter");
    expect(all.categories[0]?.mediaTypes).toEqual([]);
    expect(all.otherMoments?.memoryCount).toBe(1);

    const balloons = await birthdayCategories(familyId, sixth, "balloons");
    expect(balloons.categories.map((c) => c.collection.name)).toEqual(["Friend Party"]);
    expect(balloons.otherMoments).toBeNull();
  });
});

describe("categories", () => {
  it("adds at the end and reorders only the exact set", async () => {
    const sixth = await added(6);
    const pool = await addCategory(sixth, "Pool Day");
    const { categories } = await birthdayCategories(familyId, sixth);
    const ids = categories.map((c) => c.collection.id);
    expect(ids.at(-1)).toBe(pool.id);

    expect(await reorderCategories(sixth, ids.slice(1))).toBe(false);
    // ES2022 has no toReversed; this is a fresh copy.
    // oxlint-disable-next-line unicorn/no-array-reverse
    expect(await reorderCategories(sixth, [...ids].reverse())).toBe(true);
    const after = await birthdayCategories(familyId, sixth);
    expect(after.categories[0]?.collection.name).toBe("Pool Day");
  });
});
