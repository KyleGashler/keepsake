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
  transcript?: string;
  occurredAt: string;
  location?: string;
  author: string;
  participants: string[];
  /** "<child name or 'family'>::<collection name>" */
  collections: string[];
  photos?: number;
  audio?: { durationS: number; caption: string };
};

const MEMORIES: MemorySpec[] = [
  {
    title: "The morning we found out",
    story:
      "I took the test at 6:10am because I couldn't wait any longer, then sat on the edge of the tub for four minutes pretending to brush my teeth. When it turned, I didn't cry — I laughed. Woke Jordan up by holding it two inches from his face. He said 'is that a plus?' about six times.",
    occurredAt: "2019-09-14T13:10:00.000Z",
    location: "Home — Salt Lake City, UT",
    author: "Ali",
    participants: ["Ali", "Jordan"],
    collections: ["Mae::Finding Out"],
    photos: 1,
  },
  {
    title: "How Mae got her name",
    story:
      "It was Grandma Ruth's middle name, and we didn't decide until the drive home from the hospital tour. Jordan said it out loud in the car — 'Mae' — and neither of us said anything for a whole block. That was the whole conversation.",
    occurredAt: "2020-01-22T02:30:00.000Z",
    author: "Jordan",
    participants: ["Ali", "Jordan", "Ruth"],
    collections: ["Mae::Choosing Your Name"],
    photos: 1,
  },
  {
    title: "20 weeks — she waved",
    story:
      "The tech turned the screen toward us and there was a hand, wide open, right in front of her face. Jordan waved back before he realized he was doing it.",
    occurredAt: "2020-02-11T17:00:00.000Z",
    location: "St. Mark's Hospital",
    author: "Ali",
    participants: ["Ali", "Jordan", "Mae"],
    collections: ["Mae::Ultrasounds", "Mae::Pregnancy Journey"],
    photos: 2,
  },
  {
    title: "Meeting you",
    story:
      "3:47am, seven pounds one ounce, and the loudest cry in the building. The room went quiet the second they set her on my chest. I remember thinking she smelled like bread, which made no sense, and that I would have agreed to absolutely anything anyone asked me in that moment.",
    occurredAt: "2020-06-08T09:47:00.000Z",
    location: "St. Mark's Hospital",
    author: "Ali",
    participants: ["Ali", "Jordan", "Mae"],
    collections: ["Mae::Meeting You"],
    photos: 3,
  },
  {
    title: "Bringing you home",
    story:
      "Jordan drove 22 miles an hour the entire way. We put the car seat in the middle of the living room and just sat on the floor looking at it. Neither of us slept — not because she cried, but because we kept checking that she was breathing.",
    occurredAt: "2020-06-10T22:15:00.000Z",
    author: "Jordan",
    participants: ["Ali", "Jordan", "Mae"],
    collections: ["Mae::Bringing Baby Home"],
    photos: 2,
  },
  {
    title: "First steps, kitchen floor",
    story:
      "Four steps from the dishwasher to my knees, and she looked more surprised than we did. Then she did it eleven more times because we clapped.",
    occurredAt: "2021-07-19T01:20:00.000Z",
    location: "Home",
    author: "Jordan",
    participants: ["Mae", "Ali", "Jordan"],
    collections: ["Mae::Milestones"],
    photos: 1,
  },
  {
    title: "\"The moon is following our car\"",
    story: "Said very seriously from the back seat, then, after a long pause: \"It's okay. I think it's lonely.\"",
    transcript:
      "Mae: Mom. Mom. The moon is following our car.\nAli: It does look like that, doesn't it?\nMae: ...It's okay. I think it's lonely.\nAli: You think so?\nMae: Yeah. We can let it come.",
    occurredAt: "2024-11-02T02:40:00.000Z",
    location: "Driving home on I-215",
    author: "Ali",
    participants: ["Mae", "Ali"],
    collections: ["Mae::Quotes & Conversations"],
    audio: { durationS: 41, caption: "Recorded from the front seat" },
    photos: 1,
  },
  {
    title: "Her first real belly laugh",
    story:
      "Jordan sneezed and she lost it — this shocked, wheezing laugh that went on for a full minute. We spent the next twenty minutes fake-sneezing.",
    occurredAt: "2020-09-30T01:05:00.000Z",
    author: "Ali",
    participants: ["Mae", "Jordan"],
    collections: ["Mae::The First 3 Months", "Mae::Everyday Moments"],
    audio: { durationS: 68, caption: "The laugh, twenty seconds in" },
    photos: 1,
  },
  {
    title: "Kindergarten, first morning",
    story:
      "She picked her own outfit — striped shirt, rain boots, no rain in the forecast. Let go of my hand before the door, which I was not prepared for. She turned around once at the top of the steps and gave a small, formal wave, like a woman boarding a train.",
    occurredAt: "2025-08-19T13:45:00.000Z",
    location: "Rosecrest Elementary",
    author: "Ali",
    participants: ["Mae", "Ali", "Jordan"],
    collections: ["Mae::Milestones", "Mae::Celebrations"],
    photos: 2,
  },
  {
    title: "She gave away her spot in line",
    story:
      "At the ice cream truck, to a kid who was about to cry because the line was long. Nobody asked her to. She just stepped back and said 'you can be in front of me.' I want her to know she was like this before anyone taught her.",
    occurredAt: "2026-06-27T00:30:00.000Z",
    author: "Jordan",
    participants: ["Mae"],
    collections: ["Mae::Kindness & Character"],
    photos: 1,
  },
  {
    title: "Piano, week one",
    story: "Four notes, over and over, with total conviction. She named the song 'Storm But Happy.'",
    occurredAt: "2026-03-14T23:10:00.000Z",
    author: "Ali",
    participants: ["Mae"],
    collections: ["Mae::Talents & Hobbies"],
    audio: { durationS: 95, caption: "\"Storm But Happy\"" },
    photos: 1,
  },
  {
    title: "Two lines again",
    story:
      "Mae was napping. I told Jordan by handing him a coffee cup with the test balanced on the lid, which he did not notice for a truly impressive amount of time.",
    occurredAt: "2023-01-30T15:20:00.000Z",
    author: "Ali",
    participants: ["Ali", "Jordan"],
    collections: ["Theo::Finding Out"],
    photos: 1,
  },
  {
    title: "Telling Mae she'd be a sister",
    story:
      "We asked her what she thought about a baby coming. She thought about it for a long time and asked if the baby could have her old crib, and then, more quietly, if we would still have room for her.",
    transcript:
      "Ali: What do you think about a baby coming to live with us?\nMae: Can it have my old crib?\nJordan: It sure can.\nMae: ...Will there still be room for me?\nAli: There will always be room for you.",
    occurredAt: "2023-02-18T01:15:00.000Z",
    author: "Jordan",
    participants: ["Mae", "Ali", "Jordan"],
    collections: ["Theo::Pregnancy Journey", "Mae::Quotes & Conversations"],
    audio: { durationS: 52, caption: "Kitchen table, after dinner" },
    photos: 1,
  },
  {
    title: "Meeting Theo",
    story:
      "Faster than the first time — we barely made it. He came out furious and settled the instant he heard Jordan's voice, which is still the thing that works.",
    occurredAt: "2023-09-22T11:08:00.000Z",
    location: "St. Mark's Hospital",
    author: "Ali",
    participants: ["Ali", "Jordan", "Theo"],
    collections: ["Theo::Meeting You"],
    photos: 3,
  },
  {
    title: "Theo says \"buh\" for everything",
    story: "Ball, bird, bath, book, Dad, the dog, the vacuum. Everything is buh. We understand him perfectly.",
    occurredAt: "2025-04-11T00:50:00.000Z",
    author: "Ali",
    participants: ["Theo"],
    collections: ["Theo::Quotes & Conversations", "Theo::Everyday Moments"],
    photos: 1,
  },
  {
    title: "Asleep on Grandpa",
    story:
      "Twenty minutes into the game, both of them out cold in the same position, mouths open. Dad woke up first and said 'I was resting my eyes.'",
    occurredAt: "2026-01-04T01:30:00.000Z",
    location: "Grandma and Grandpa's",
    author: "Ali",
    participants: ["Theo", "Frank"],
    collections: ["family::Grandparents", "Theo::Everyday Moments"],
    photos: 1,
  },
  {
    title: "Grandma Ruth's rolls, written down at last",
    story:
      "I finally recorded her making them instead of promising myself I'd write it down. She doesn't measure anything. The recipe, as recorded, includes the phrase 'until it feels right, you'll know.'",
    transcript:
      "Ruth: You don't measure the flour, you just go until it feels right, you'll know.\nAli: Grandma, people need numbers.\nRuth: My mother didn't use numbers. Add the butter while it's warm — not hot, warm — or you'll kill the yeast and then we're eating crackers.",
    occurredAt: "2025-11-27T18:00:00.000Z",
    location: "Grandma and Grandpa's kitchen",
    author: "Ali",
    participants: ["Ruth", "Ali"],
    collections: ["family::Grandparents", "family::Holidays"],
    audio: { durationS: 431, caption: "Full recording — 7 minutes" },
    photos: 2,
  },
  {
    title: "Bear Lake, third summer in a row",
    story:
      "Same rented cabin, same raspberry shakes, same argument about who packed the sunscreen. Mae swam past the buoy for the first time and Theo ate exactly one handful of sand.",
    occurredAt: "2026-07-12T20:00:00.000Z",
    location: "Bear Lake, UT",
    author: "Jordan",
    participants: ["Ali", "Jordan", "Mae", "Theo"],
    collections: ["family::Vacations"],
    photos: 4,
  },
  {
    title: "Saturday pancakes",
    story:
      "The pancake thing started because we were out of everything else, and now it's a rule. Jordan does the batter, Mae does the flipping, Theo does the supervising and the eating.",
    occurredAt: "2026-05-16T15:20:00.000Z",
    location: "Home",
    author: "Ali",
    participants: ["Ali", "Jordan", "Mae", "Theo"],
    collections: ["family::At Home"],
    photos: 2,
  },
  {
    title: "The day we got Biscuit",
    story:
      "We went to 'just look.' We were home with a dog in ninety minutes. Mae named him before we reached the parking lot and would not be talked out of it.",
    occurredAt: "2024-04-06T22:45:00.000Z",
    author: "Jordan",
    participants: ["Mae", "Jordan", "Ali"],
    collections: ["family::Pets"],
    photos: 2,
  },
  {
    title: "Halloween — a dinosaur and a slightly smaller dinosaur",
    story: "Mae insisted Theo match her. Theo did not know he was a dinosaur. He was extremely pleased regardless.",
    occurredAt: "2025-11-01T01:30:00.000Z",
    author: "Ali",
    participants: ["Mae", "Theo"],
    collections: ["family::Holidays"],
    photos: 3,
  },
  {
    title: "Aquarium, rainy Tuesday",
    story:
      "Theo pressed his whole face against the jellyfish tank for eleven straight minutes. Mae read every placard out loud to him. He did not care about a single one.",
    occurredAt: "2026-02-24T19:30:00.000Z",
    location: "Living Planet Aquarium",
    author: "Jordan",
    participants: ["Mae", "Theo", "Jordan"],
    collections: ["family::Family Outings"],
    photos: 2,
  },
  {
    title: "The last time she asked me to carry her upstairs",
    story:
      "I didn't know it was the last time. That's the whole reason this app exists, I think — I wrote it down two weeks later when I realized it had stopped happening and I couldn't remember which night it was.",
    occurredAt: "2026-04-30T04:00:00.000Z",
    author: "Ali",
    participants: ["Mae", "Ali"],
    collections: ["Mae::Everyday Moments"],
    photos: 1,
  },
  {
    title: "Theo's first birthday, cake destroyed",
    story: "Total structural failure of the cake within nine seconds. Grandma Ruth has never laughed harder.",
    occurredAt: "2024-09-22T23:00:00.000Z",
    author: "Ali",
    participants: ["Theo", "Ali", "Jordan", "Mae", "Ruth", "Frank"],
    collections: ["Theo::Celebrations", "Theo::Milestones"],
    photos: 3,
  },
];

const PROMPTS = [
  {
    text: "What did Theo say today that you want to remember?",
    subtitle: "He's in the season where the words change every week.",
    imageSeed: "prompt-theo-words",
  },
  {
    text: "Mae turns six in six weeks.",
    subtitle: "Capture something about who she is right now, before it shifts.",
    imageSeed: "prompt-mae-six",
  },
  {
    text: "Record Grandpa Frank telling one story.",
    subtitle: "Any story. The one he always tells counts.",
    imageSeed: "prompt-grandpa-story",
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
  {
    text: "Summer is almost over.",
    subtitle: "What will this one be remembered for?",
    imageSeed: "prompt-summer-end",
  },
];

async function main() {
  const existing = await prisma.family.findFirst();
  if (existing && process.env.SEED_RESET !== "1") {
    console.log(`Seed skipped — "${existing.name}" already exists. Use SEED_RESET=1 to rebuild.`);
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

  // Avatar rings come from the brand palette: the warm hues for the household,
  // the quieter ones for the grandparents.
  const peopleSpec = [
    { name: "Ali", role: "PARENT", relation: "Mom", accentColor: "#D68A75", birthDate: "1991-03-12" },
    { name: "Jordan", role: "PARENT", relation: "Dad", accentColor: "#8FA1A6", birthDate: "1990-07-04" },
    { name: "Mae", role: "CHILD", relation: "Daughter", accentColor: "#D49A4A", birthDate: "2020-06-08" },
    { name: "Theo", role: "CHILD", relation: "Son", accentColor: "#A3AA9A", birthDate: "2023-09-22" },
    { name: "Ruth", role: "GRANDPARENT", relation: "Grandma", accentColor: "#2F362E", birthDate: "1958-02-20" },
    { name: "Frank", role: "GRANDPARENT", relation: "Grandpa", accentColor: "#6E8288", birthDate: "1956-10-09" },
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
  const owner = people.Ali;
  const demoUser = await prisma.user.create({
    data: {
      authProviderId: "dev:demo@keepsake.local",
      email: "demo@keepsake.local",
      displayName: owner.name,
    },
  });
  await prisma.person.update({ where: { id: owner.id }, data: { userId: demoUser.id } });
  await prisma.familyMembership.create({
    data: { userId: demoUser.id, familyId: family.id, role: "OWNER", personId: owner.id },
  });

  const children = [people.Mae, people.Theo];
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

    const photos = Array.from({ length: spec.photos ?? 1 }, (_, i) => ({
      type: "PHOTO" as const,
      url: `/media/gen/${heroSeed}-${i}.png?w=1400&h=1050`,
      width: 1400,
      height: 1050,
      // Placeholders are complete the moment they exist — there is no upload
      // to wait on, so they skip the UPLOADING phase.
      status: "READY" as const,
      sortOrder: i,
    }));
    const audio = spec.audio
      ? [
          {
            type: "AUDIO" as const,
            // Placeholder artwork for the recording card; playback lands with real capture.
            url: `/media/gen/${heroSeed}-audio.png?w=900&h=300`,
            width: 900,
            height: 300,
            status: "READY" as const,
            durationS: spec.audio.durationS,
            caption: spec.audio.caption,
            sortOrder: photos.length,
          },
        ]
      : [];

    await prisma.memory.create({
      data: {
        familyId: family.id,
        title: spec.title,
        story: spec.story ?? null,
        transcript: spec.transcript ?? null,
        occurredAt: new Date(spec.occurredAt),
        location: spec.location ?? null,
        authorId: people[spec.author].id,
        heroSeed,
        paletteHue: hueForSeed(`${heroSeed}-0`),
        brightness: 35 + (heroSeed.length % 45),
        media: { create: [...photos, ...audio] },
        participants: { create: spec.participants.map((n) => ({ personId: people[n].id })) },
        collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
      },
    });
  }

  for (const [i, prompt] of PROMPTS.entries()) {
    await prisma.capturePrompt.create({ data: { familyId: family.id, sortOrder: i, ...prompt } });
  }

  // Family Updates — journal entries, not notifications.
  const updates = [
    { actor: "Ruth", kind: "memory_added", message: "Grandma Ruth added a new memory.", hoursAgo: 5 },
    { actor: "Jordan", kind: "media_added", message: "Dad uploaded 4 photos from Bear Lake.", hoursAgo: 26 },
    { actor: "Frank", kind: "audio_added", message: "Grandpa recorded a voice memory.", hoursAgo: 52 },
    { actor: "Ali", kind: "collection_added", message: "Mom started a new collection: Talents & Hobbies.", hoursAgo: 96 },
    { actor: "Jordan", kind: "person_added", message: "Grandpa Frank joined the family archive.", hoursAgo: 168 },
  ];
  for (const u of updates) {
    await prisma.activityEvent.create({
      data: {
        familyId: family.id,
        actorId: people[u.actor].id,
        kind: u.kind,
        message: u.message,
        createdAt: new Date(Date.now() - u.hoursAgo * 3_600_000),
      },
    });
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
