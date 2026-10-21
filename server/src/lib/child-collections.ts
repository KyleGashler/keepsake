import type { Collection, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "./prisma.js";

/**
 * The collections every child starts with, and the one place they're defined.
 *
 * A child's Library is built from `Collection` rows whose `personId` is the
 * child. The seven Child Profile defaults carry a `kind` — a stable template
 * key the client uses to pick a renderer (quotes get a pull-quote card) — so a
 * family can rename "Milestones" without the app forgetting what it is.
 * Arrival Stories defaults have no kind; they're plain collections a new child
 * is given once.
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
  /** Older names this default went by; an unclaimed row with one is adopted. */
  aliases?: string[];
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
    aliases: ["Everyday Moments"],
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

const normalise = (name: string) => name.trim().toLowerCase();

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Give one child the default collections they're missing. Idempotent.
 *
 * Child Profiles: each template is matched to an existing row of the child's
 * by `kind`; failing that, by name (or alias) among rows with no kind yet —
 * that row is adopted (kind, glyph and colour set; an alias renamed; a missing
 * description filled). Whatever is still unmatched is created. Rows already
 * carrying a kind are never touched again, so a family's renames stick, and
 * collections the template doesn't recognise are left alone.
 *
 * Arrival Stories: created only when the child has none at all, so a family
 * that prunes them doesn't see them come back.
 *
 * Returns how many rows were created or adopted. A no-op for anyone who isn't
 * a CHILD of `familyId`.
 */
export async function ensureChildCollections(familyId: string, personId: string, db: Db = defaultClient) {
  const person = await db.person.findFirst({
    where: { id: personId, familyId, role: "CHILD" },
    select: { id: true },
  });
  if (!person) return 0;

  const existing = await db.collection.findMany({ where: { familyId, personId } });
  const childRows = existing.filter((c) => c.pillar === "CHILD_PROFILES");
  const claimed = new Set<string>();
  let changed = 0;

  const toCreate: Prisma.CollectionCreateManyInput[] = [];
  for (const [sortOrder, t] of CHILD_COLLECTIONS.entries()) {
    const byKind = childRows.find((c) => c.kind === t.kind);
    if (byKind) {
      claimed.add(byKind.id);
      continue;
    }
    const names = new Set([t.name, ...(t.aliases ?? [])].map(normalise));
    const byName = childRows.find((c) => !c.kind && !claimed.has(c.id) && names.has(normalise(c.name)));
    if (byName) {
      claimed.add(byName.id);
      await adopt(db, byName, t, sortOrder);
      changed++;
      continue;
    }
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

  if (toCreate.length) {
    // skipDuplicates leans on @@unique([personId, kind]): a concurrent call
    // that got there first makes these no-ops rather than duplicates.
    const created = await db.collection.createMany({ data: toCreate, skipDuplicates: true });
    changed += created.count;
  }
  return changed;
}

function adopt(db: Db, row: Collection, t: ChildCollectionTemplate, sortOrder: number) {
  return db.collection.update({
    where: { id: row.id },
    data: {
      kind: t.kind,
      icon: t.icon,
      color: t.color,
      // Only a row still wearing an old default name is renamed; one that
      // matched on the current name keeps its own spelling.
      ...(normalise(row.name) === normalise(t.name) ? {} : { name: t.name }),
      description: row.description ?? t.description,
      sortOrder,
    },
  });
}

/** Run `ensureChildCollections` for every child in every family. Boot-time backfill. */
export async function ensureAllChildCollections(db: Db = defaultClient) {
  const children = await db.person.findMany({
    where: { role: "CHILD" },
    select: { id: true, familyId: true },
  });
  let changed = 0;
  for (const child of children) changed += await ensureChildCollections(child.familyId, child.id, db);
  return { children: children.length, changed };
}
