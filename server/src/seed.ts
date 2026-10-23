import { PrismaClient, type Person } from "@prisma/client";
import { ensureAllChildCollections, ensureChildCollections } from "./lib/child-collections.js";
import { hueForSeed } from "./lib/placeholder.js";

const prisma = new PrismaClient();

/**
 * Seeds one demo family so the app has a story to tell on first run.
 * Idempotent: skips if a family already exists unless SEED_RESET=1. Every run
 * — skipped or not — also tops up every child's default collections (see
 * lib/child-collections.ts), which is how existing databases pick up new
 * defaults: this runs on every boot where SEED_DEMO=1.
 */

/**
 * Family Life's starting set. A child's collections come from
 * lib/child-collections.ts; icons and colours here match the backfill in the
 * library_journey migration.
 */
const FAMILY_COLLECTIONS = [
  { name: "At Home", icon: "home", color: "#123F45" },
  { name: "Family Outings", icon: "sun", color: "#D4A04C" },
  { name: "Vacations", icon: "plane", color: "#8EADC1" },
  { name: "Holidays", icon: "star", color: "#D86A4E" },
  { name: "Grandparents", icon: "heart", color: "#2F5E45" },
  { name: "Pets", icon: "paw", color: "#9AA383" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

type MemorySpec = {
  title: string;
  story?: string;
  occurredAt: string;
  location?: string;
  author: string;
  participants: string[];
  /** "<child name>::<collection kind>" or "family::<collection name>" */
  collections: string[];
};

/**
 * Deliberately small and text-only: enough that every Library screen has
 * something on a fresh database — a quote, a milestone, a birthday and an
 * everyday moment for Banks, one of them shared with Bear. Everything else in
 * the archive should be something a person actually captured, so it shows the
 * real upload and transcript paths. No fake media.
 */
const MEMORIES: MemorySpec[] = [
  {
    title: "The last time Banks asked to be carried upstairs",
    story:
      "I didn't know it was the last time. That's the whole reason this app exists, I think — I wrote it down two weeks later when I realized it had stopped happening and I couldn't remember which night it was.",
    occurredAt: "2026-04-30T04:00:00.000Z",
    author: "Ali",
    participants: ["Banks", "Ali"],
    collections: ["Banks::day_to_day"],
  },
  {
    title: "“Is the moon following us home?”",
    story:
      "From the back seat, on the drive home from Grandma's. I said it only looks that way. A mile later: “Then it's walking us home.”",
    occurredAt: "2024-10-03T01:30:00.000Z",
    location: "The drive home",
    author: "Ali",
    participants: ["Banks", "Ali"],
    collections: ["Banks::quotes"],
  },
  {
    title: "No more training wheels",
    story:
      "Three laps of the cul-de-sac, then a fourth just to be sure. Never once looked back to check I was still holding on. I wasn't.",
    occurredAt: "2025-06-21T23:00:00.000Z",
    location: "The cul-de-sac",
    author: "Ali",
    participants: ["Banks"],
    collections: ["Banks::milestones"],
  },
  {
    title: "Six, and a stegosaurus cake",
    story:
      "Asked for a cake shaped like a stegosaurus, then ate the plates off its back before anyone could cut it. Six candles, one wish, and a firm refusal to say what it was.",
    occurredAt: "2026-05-14T22:00:00.000Z",
    author: "Ali",
    participants: ["Banks", "Ali"],
    collections: ["Banks::birthdays"],
  },
  {
    title: "Pancake Saturday",
    story:
      "Banks stood on the step stool and did the flipping. Bear was in charge of blueberries and ate about half of them. Nobody minded the shapes.",
    occurredAt: "2026-03-07T16:00:00.000Z",
    location: "Our kitchen",
    author: "Ali",
    participants: ["Banks", "Bear", "Ali"],
    collections: ["Banks::day_to_day", "Bear::day_to_day"],
  },
];

const PROMPTS = [
  {
    text: "What did Banks say today that you want to remember?",
    subtitle: "The words change every week at this age.",
    imageSeed: "prompt-mae-words",
  },
  {
    text: "What does an ordinary Tuesday look like right now?",
    subtitle: "The ordinary days are the ones that disappear first.",
    imageSeed: "prompt-ordinary-tuesday",
  },
  {
    text: "Preserve the sound of the house at bedtime.",
    subtitle: "Thirty seconds is enough.",
    imageSeed: "prompt-bedtime",
  },
];

/**
 * The one signing-in user, so the auth work has something to resolve against.
 * The first PARENT is the account holder; other adults get invites later and
 * the children never become Users at all. Idempotent: safe on every boot.
 */
async function ensureDemoUser(familyId: string) {
  const owner = await prisma.person.findFirst({
    where: { familyId, role: "PARENT" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!owner) return;

  // Already owned — by the demo user, or by the real account that took the
  // demo user over (a verified Firebase sign-in with the same email rebinds
  // it; see resolveUser in src/auth/middleware.ts). Re-creating a dev owner
  // beside a real one would leave a second OWNER nobody can sign in as.
  const owned = await prisma.familyMembership.findFirst({ where: { familyId, role: "OWNER" } });
  if (owned) return;

  const demoUser = await prisma.user.upsert({
    where: { authProviderId: "dev:demo@littlebylittle.local" },
    update: {},
    create: {
      authProviderId: "dev:demo@littlebylittle.local",
      email: "demo@littlebylittle.local",
      displayName: owner.name,
    },
  });

  const membership = await prisma.familyMembership.findUnique({
    where: { userId_familyId: { userId: demoUser.id, familyId } },
  });
  if (membership) return;

  if (!owner.userId) {
    await prisma.person.update({ where: { id: owner.id }, data: { userId: demoUser.id } });
  }
  await prisma.familyMembership.create({
    data: { userId: demoUser.id, familyId, role: "OWNER", personId: owner.id },
  });
  console.log(`Demo owner demo@littlebylittle.local attached to family ${familyId} as ${owner.name}.`);
}

async function main() {
  const existing = await prisma.family.findFirst();
  if (existing && process.env.SEED_RESET !== "1") {
    console.log(`Seed skipped — "${existing.name}" already exists. Use SEED_RESET=1 to rebuild.`);
    // A database seeded before accounts existed has the family but no one who
    // can sign in to it. Attach the demo owner so the dev bridge resolves.
    await ensureDemoUser(existing.id);
    const topUp = await ensureAllChildCollections(prisma);
    if (topUp.changed) console.log(`Child collections topped up: ${topUp.changed} across ${topUp.children} children.`);
    return;
  }
  if (existing) {
    console.log("SEED_RESET=1 — clearing existing data.");
    // Deleting a Family cascades to its people, collections, memories, media,
    // derivatives, activity, prompts, memberships, invites and subscription.
    // Users hang off no family, so they (and their device tokens, which do
    // cascade) go separately; jobs are family-independent too.
    await prisma.family.deleteMany();
    await prisma.user.deleteMany();
    await prisma.job.deleteMany();
  }

  const family = await prisma.family.create({ data: { name: "the Bryners" } });

  // Avatar rings come from the brand palette. One parent (the demo owner) and
  // three children, so the child screens show a list rather than a single card
  // and the youngest has an empty Library.
  const peopleSpec = [
    { name: "Ali", role: "PARENT", relation: "Mom", accentColor: "#D68A75", birthDate: "1991-03-12" },
    { name: "Banks", role: "CHILD", relation: null, accentColor: "#D49A4A", birthDate: "2020-05-14" },
    { name: "Bear", role: "CHILD", relation: null, accentColor: "#7FA39A", birthDate: "2022-03-02" },
    { name: "Collins", role: "CHILD", relation: null, accentColor: "#C98A9B", birthDate: "2026-02-10" },
  ] as const;

  const people: Record<string, Person> = {};
  for (const [i, spec] of peopleSpec.entries()) {
    people[spec.name] = await prisma.person.create({
      data: {
        familyId: family.id,
        name: spec.name,
        role: spec.role,
        relation: spec.relation,
        accentColor: spec.accentColor,
        birthDate: new Date(spec.birthDate),
        avatarSeed: `person-${slug(spec.name)}`,
        sortOrder: i,
      },
    });
  }

  // One signing-in user so the auth work (A3/A4) has something to resolve
  // against. Ali is the account holder; the other adults get invites later and
  // the children never become Users at all.
  await ensureDemoUser(family.id);

  const children = [people.Banks, people.Bear, people.Collins];
  const collections: Record<string, string> = {};

  // Every child starts with the same defaults a child added in the app gets.
  // Families can rename or add to these at any time.
  for (const child of children) {
    await ensureChildCollections(family.id, child.id, prisma);
    const own = await prisma.collection.findMany({
      where: { familyId: family.id, personId: child.id, kind: { not: null } },
    });
    for (const c of own) if (c.kind) collections[`${child.name}::${c.kind}`] = c.id;
  }
  for (const [i, spec] of FAMILY_COLLECTIONS.entries()) {
    const created = await prisma.collection.create({
      data: {
        familyId: family.id,
        name: spec.name,
        pillar: "FAMILY_LIFE",
        icon: spec.icon,
        color: spec.color,
        sortOrder: i,
        coverSeed: `collection-${slug(`family::${spec.name}`)}`,
      },
    });
    collections[`family::${spec.name}`] = created.id;
  }

  for (const spec of MEMORIES) {
    const heroSeed = `memory-${slug(spec.title)}`;
    const collectionIds = spec.collections
      .map((key) => collections[key])
      .filter((id): id is string => Boolean(id));
    if (collectionIds.length !== spec.collections.length) {
      throw new Error(`Unknown collection in "${spec.title}": ${spec.collections.join(", ")}`);
    }

    await prisma.memory.create({
      data: {
        familyId: family.id,
        title: spec.title,
        story: spec.story ?? null,
        occurredAt: new Date(spec.occurredAt),
        location: spec.location ?? null,
        authorId: people[spec.author].id,
        heroSeed,
        paletteHue: hueForSeed(`${heroSeed}-0`),
        brightness: 35 + (heroSeed.length % 45),
        participants: { create: spec.participants.map((n) => ({ personId: people[n].id })) },
        collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
      },
    });
  }

  for (const [i, prompt] of PROMPTS.entries()) {
    await prisma.capturePrompt.create({ data: { familyId: family.id, sortOrder: i, ...prompt } });
  }

  const counts = {
    users: 1,
    people: Object.keys(people).length,
    collections: await prisma.collection.count({ where: { familyId: family.id } }),
    memories: MEMORIES.length,
  };
  console.log(`Seeded "${family.name}":`, counts);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
