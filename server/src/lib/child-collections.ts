import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "./prisma.js";

/**
 * The collections every child starts with, and the one place they're defined.
 *
 * A child's Library is built from `Collection` rows whose `personId` is the
 * child. The seven Child Profile defaults carry a `kind` — a stable template
 * key the client uses to pick a renderer (quotes get a pull-quote card) — so a
 * family can rename "Milestones" without the app forgetting what it is.
 * Arrival Stories defaults have no kind; they're plain collections.
 *
 * Every default is a suggestion: a new child is given them once, and a family
 * may rename or delete any of them. Nothing ever puts a deleted one back.
 */

/**
 * Glyph keys a collection disc may use. Opaque strings: the client maps each
 * to an icon. The first seven are the Child Profile defaults' own.
 */
export const COLLECTION_ICONS = [
  "sparkles",
  "rainbow",
  "chat",
  "cake",
  "heart",
  "butterfly",
  "moon",
  "star",
  "book",
  "music",
  "leaf",
  "sun",
  "camera",
  "home",
  "paw",
  "plane",
] as const;

export type CollectionIcon = (typeof COLLECTION_ICONS)[number];

export const DEFAULT_COLLECTION_ICON: CollectionIcon = "star";
export const DEFAULT_COLLECTION_COLOR = "#123F45";

export type CollectionTemplate = {
  name: string;
  description?: string;
  icon: CollectionIcon;
  color: string;
};

export type ChildCollectionTemplate = CollectionTemplate & {
  kind: string;
  description: string;
};

/** In display order: `sortOrder` is the index. */
export const CHILD_COLLECTIONS: readonly ChildCollectionTemplate[] = [
  {
    kind: "milestones",
    name: "Milestones",
    description: "The big (and little) moments that mark growth.",
    icon: "sparkles",
    color: "#D4A04C",
  },
  {
    kind: "day_to_day",
    name: "Day-to-Day Moments",
    description: "The little everyday moments you'll miss most one day.",
    icon: "rainbow",
    color: "#9AA383",
  },
  {
    kind: "quotes",
    name: "Quotes & Conversations",
    description: "The things you say, the things they say.",
    icon: "chat",
    color: "#123F45",
  },
  {
    kind: "birthdays",
    name: "Birthdays",
    description: "Every birthday, a new chapter.",
    icon: "cake",
    color: "#D86A4E",
  },
  {
    kind: "kindness",
    name: "Kindness & Character",
    description: "The good you see in them every day.",
    icon: "heart",
    color: "#2F5E45",
  },
  {
    kind: "talents",
    name: "Talents & Hobbies",
    description: "The things you love learning, making, and becoming.",
    icon: "butterfly",
    color: "#8EADC1",
  },
  {
    kind: "phases",
    name: "Phases & Obsessions",
    description: "The little things you just can't get enough of.",
    icon: "moon",
    color: "#F0DCC8",
  },
];

/**
 * A new child's Arrival Stories. Icons and colours match the backfill in the
 * library_journey migration, which gave existing rows the same.
 */
export const ARRIVAL_COLLECTIONS: readonly CollectionTemplate[] = [
  { name: "Finding Out", icon: "sparkles", color: "#D4A04C" },
  { name: "Choosing Your Name", icon: "book", color: "#123F45" },
  { name: "Pregnancy Journey", icon: "moon", color: "#8EADC1" },
  { name: "Ultrasounds", icon: "camera", color: "#9AA383" },
  { name: "Gender Reveal", icon: "star", color: "#D86A4E" },
  { name: "Baby Shower", icon: "cake", color: "#F0DCC8" },
  { name: "Meeting You", icon: "heart", color: "#2F5E45" },
  { name: "Bringing Baby Home", icon: "home", color: "#D4A04C" },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Give a newly added child their default collections. Each pillar's set is
 * created only when the child has no collection in that pillar at all, so a
 * repeat call is a no-op and a family that prunes the suggestions doesn't see
 * them come back.
 *
 * Returns how many rows were created. A no-op for anyone who isn't a CHILD of
 * `familyId`.
 */
export async function ensureChildCollections(familyId: string, personId: string, db: Db = defaultClient) {
  const person = await db.person.findFirst({
    where: { id: personId, familyId, role: "CHILD" },
    select: { id: true },
  });
  if (!person) return 0;

  const existing = await db.collection.findMany({ where: { familyId, personId }, select: { pillar: true } });
  const toCreate: Prisma.CollectionCreateManyInput[] = [];

  if (!existing.some((c) => c.pillar === "CHILD_PROFILES")) {
    for (const [sortOrder, t] of CHILD_COLLECTIONS.entries()) {
      toCreate.push({
        familyId,
        personId,
        pillar: "CHILD_PROFILES",
        kind: t.kind,
        name: t.name,
        description: t.description,
        icon: t.icon,
        color: t.color,
        isDefault: true,
        sortOrder,
        coverSeed: `collection-${personId}-${t.kind}`,
      });
    }
  }

  if (!existing.some((c) => c.pillar === "ARRIVAL_STORIES")) {
    for (const [sortOrder, t] of ARRIVAL_COLLECTIONS.entries()) {
      toCreate.push({
        familyId,
        personId,
        pillar: "ARRIVAL_STORIES",
        name: t.name,
        icon: t.icon,
        color: t.color,
        isDefault: true,
        sortOrder,
        coverSeed: `collection-${personId}-${slug(t.name)}`,
      });
    }
  }

  if (!toCreate.length) return 0;
  // skipDuplicates leans on @@unique([personId, kind]): a concurrent call
  // that got there first makes these no-ops rather than duplicates.
  const created = await db.collection.createMany({ data: toCreate, skipDuplicates: true });
  return created.count;
}
