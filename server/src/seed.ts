import { Pillar, PrismaClient, type Person } from "@prisma/client";
import { hueForSeed } from "./lib/placeholder.js";

const prisma = new PrismaClient();

/**
 * Seeds one demo family so the app has a story to tell on first run.
 * Idempotent: skips if a family already exists unless SEED_RESET=1.
 */

const ARRIVAL_COLLECTIONS = [
  "Finding Out",
  "Choosing Your Name",
  "Pregnancy Journey",
  "Ultrasounds",
  "Gender Reveal",
  "Baby Shower",
  "Meeting You",
  "Bringing Baby Home",
];

const CHILD_COLLECTIONS = [
  "The First 3 Months",
  "Milestones",
  "Everyday Moments",
  "Quotes & Conversations",
  "Celebrations",
  "Kindness & Character",
  "Talents & Hobbies",
];

const FAMILY_COLLECTIONS = ["At Home", "Family Outings", "Vacations", "Holidays", "Grandparents", "Pets"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

type MemorySpec = {
  title: string;
  story?: string;
  occurredAt: string;
  location?: string;
  author: string;
  participants: string[];
  /** "<child name or 'family'>::<collection name>" */
  collections: string[];
};

/**
 * Deliberately small: one text-only memory so Home and the Library aren't
 * empty on first run. Everything else in the archive should be something a
 * person actually captured, so it shows the real upload and transcript paths.
 */
const MEMORIES: MemorySpec[] = [
  {
    title: "The last time she asked me to carry her upstairs",
    story:
      "I didn't know it was the last time. That's the whole reason this app exists, I think — I wrote it down two weeks later when I realized it had stopped happening and I couldn't remember which night it was.",
    occurredAt: "2026-04-30T04:00:00.000Z",
    author: "Ali",
    participants: ["Mae", "Ali"],
    collections: ["Mae::Everyday Moments"],
  },
];

const PROMPTS = [
  {
    text: "What did Mae say today that you want to remember?",
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

  const demoUser = await prisma.user.upsert({
    where: { authProviderId: "dev:demo@keepsake.local" },
    update: {},
    create: {
      authProviderId: "dev:demo@keepsake.local",
      email: "demo@keepsake.local",
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
  console.log(`Demo owner demo@keepsake.local attached to family ${familyId} as ${owner.name}.`);
}

async function main() {
  const existing = await prisma.family.findFirst();
  if (existing && process.env.SEED_RESET !== "1") {
    console.log(`Seed skipped — "${existing.name}" already exists. Use SEED_RESET=1 to rebuild.`);
    // A database seeded before accounts existed has the family but no one who
    // can sign in to it. Attach the demo owner so the dev bridge resolves.
    await ensureDemoUser(existing.id);
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
  // one child, so the child-scoped pillars have someone to file under.
  const peopleSpec = [
    { name: "Ali", role: "PARENT", relation: "Mom", accentColor: "#D68A75", birthDate: "1991-03-12" },
    { name: "Mae", role: "CHILD", relation: "Daughter", accentColor: "#D49A4A", birthDate: "2020-06-08" },
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

  const children = [people.Mae];
  const collections: Record<string, string> = {};

  const addCollection = async (
    key: string,
    name: string,
    pillar: Pillar,
    sortOrder: number,
    personId?: string,
  ) => {
    const created = await prisma.collection.create({
      data: {
        familyId: family.id,
        name,
        pillar,
        personId: personId ?? null,
        sortOrder,
        coverSeed: `collection-${slug(key)}`,
      },
    });
    collections[key] = created.id;
  };

  // Every child starts with the default set from the product spec. Families can
  // rename, remove, or add to these at any time.
  for (const child of children) {
    for (const [i, name] of ARRIVAL_COLLECTIONS.entries()) {
      await addCollection(`${child.name}::${name}`, name, "ARRIVAL_STORIES", i, child.id);
    }
    for (const [i, name] of CHILD_COLLECTIONS.entries()) {
      await addCollection(`${child.name}::${name}`, name, "CHILD_PROFILES", i, child.id);
    }
  }
  for (const [i, name] of FAMILY_COLLECTIONS.entries()) {
    await addCollection(`family::${name}`, name, "FAMILY_LIFE", i);
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
    collections: Object.keys(collections).length,
    memories: MEMORIES.length,
  };
  console.log(`Seeded "${family.name}":`, counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
