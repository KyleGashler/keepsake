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

  const [people, recent, updates, prompts] = await Promise.all([
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
  ]);

  // Prompts rotate daily. In a later version this is where the AI-generated
  // prompt (upcoming birthdays, growth spurts, seasons) would come from.
  const prompt = prompts.length ? prompts[dayIndex(now) % prompts.length] : null;
  const memoryCount = await prisma.memory.count({ where: { familyId: family.id } });

  res.json({
    family: { id: family.id, name: family.name },
    greeting: {
      salutation: `${timeOfDay(now)}, ${family.name}`,
      message: WELCOME_LINES[dayIndex(now) % WELCOME_LINES.length],
    },
    people: people.map(personDto),
    prompt: prompt
      ? {
          id: prompt.id,
          text: prompt.text,
          subtitle: prompt.subtitle,
          imageUrl: imageUrl(prompt.imageSeed, 1200, 1400),
        }
      : null,
    storySoFar: await memoryCardDtos(recent),
    updates: updates.map((u) => ({
      id: u.id,
      kind: u.kind,
      message: u.message,
      actor: u.actor ? personDto(u.actor) : null,
      createdAt: u.createdAt.toISOString(),
    })),
    stats: { memoryCount, personCount: people.length },
  });
});
