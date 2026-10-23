import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { imageUrl, mediaInclude, memoryCardDtos, personDto } from "../lib/serialize.js";

export const homeRouter = Router();

/** Warm, rotating lines that reinforce why the archive exists. */
const WELCOME_LINES = [
  "Your family's story grew a little today.",
  "Somewhere in today is a moment worth keeping.",
  "The ordinary days are the ones you'll miss most.",
  "Every memory you preserve is a gift to someone later.",
  "Nothing here needs to be perfect — only true.",
  "Small moments, kept carefully, become a life.",
  "Today is already becoming a memory.",
];

/** Said instead of a welcome line until the family's first memory. */
const FIRST_DAY_LINE = "Welcome to your family's archive. Start with one small moment.";

/**
 * Prompts for a family that has none of its own — every family made in the
 * app, since only the seed writes CapturePrompt rows — so Home always has
 * one moment to suggest.
 */
const DEFAULT_PROMPTS = [
  {
    id: "default-ordinary-day",
    text: "What does an ordinary day look like right now?",
    subtitle: "The ordinary days are the ones that disappear first.",
    imageSeed: "prompt-ordinary-tuesday",
  },
  {
    id: "default-how-we-met",
    text: "Tell the story of how your family began.",
    subtitle: "A voice note is enough. Someone will want to hear it.",
    imageSeed: "prompt-how-we-met",
  },
  {
    id: "default-bedtime",
    text: "Preserve the sound of the house at bedtime.",
    subtitle: "Thirty seconds is enough.",
    imageSeed: "prompt-bedtime",
  },
  {
    id: "default-photo-today",
    text: "Take one photo of today, just as it is.",
    subtitle: "Nothing needs tidying first.",
    imageSeed: "prompt-photo-today",
  },
];

function timeOfDay(date: Date) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function dayIndex(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

homeRouter.get("/home", async (req, res) => {
  const family = req.ctx.family;
  const now = new Date();

  const [people, recent, updates, prompts, membership, inviteCount, memberCount] = await Promise.all([
    prisma.person.findMany({
      where: { familyId: family.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.memory.findMany({
      where: { familyId: family.id },
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: { media: mediaInclude, participants: { include: { person: true } } },
    }),
    prisma.activityEvent.findMany({
      where: { familyId: family.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: true },
    }),
    prisma.capturePrompt.findMany({
      where: { familyId: family.id },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: req.ctx.user.id, familyId: family.id } },
      select: { personId: true, person: { select: { name: true } } },
    }),
    prisma.invite.count({ where: { familyId: family.id } }),
    prisma.familyMembership.count({ where: { familyId: family.id } }),
  ]);

  // Prompts rotate daily. In a later version this is where the AI-generated
  // prompt (upcoming birthdays, growth spurts, seasons) would come from.
  const promptPool = prompts.length ? prompts : DEFAULT_PROMPTS;
  const prompt = promptPool[dayIndex(now) % promptPool.length];
  const memoryCount = await prisma.memory.count({ where: { familyId: family.id } });
  // Greet the person signed in, not the family; the account name stands in
  // when they have no Person here.
  const viewerName = membership?.person?.name ?? req.ctx.user.displayName;

  res.json({
    family: { id: family.id, name: family.name },
    greeting: {
      salutation: `${timeOfDay(now)}, ${viewerName.split(" ")[0]}`,
      message: memoryCount ? WELCOME_LINES[dayIndex(now) % WELCOME_LINES.length] : FIRST_DAY_LINE,
    },
    people: people.map(personDto),
    prompt: {
      id: prompt.id,
      text: prompt.text,
      subtitle: prompt.subtitle,
      imageUrl: imageUrl(prompt.imageSeed, 1200, 1400),
    },
    storySoFar: await memoryCardDtos(recent),
    updates: updates.map((u) => ({
      id: u.id,
      kind: u.kind,
      message: u.message,
      actor: u.actor ? personDto(u.actor) : null,
      createdAt: u.createdAt.toISOString(),
    })),
    stats: { memoryCount, personCount: people.length },
    // Home's getting-started checklist; the app decides which steps this
    // person's role can take, and hides the list once those are done.
    gettingStarted: {
      firstMemory: memoryCount > 0,
      addedSomeone: people.some((p) => p.role !== "CHILD" && p.id !== membership?.personId),
      addedChild: people.some((p) => p.role === "CHILD"),
      invitedSomeone: inviteCount > 0 || memberCount > 1,
    },
  });
});
