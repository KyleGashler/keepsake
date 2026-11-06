import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { mediaInclude, memoryCardDto, personDto } from "../lib/serialize.js";

export const timelineRouter = Router();

timelineRouter.get("/timeline", async (req, res) => {
  const familyId = req.ctx.family.id;
  const [children, memories] = await Promise.all([
    prisma.person.findMany({
      where: { familyId, role: "CHILD" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.memory.findMany({
      where: { familyId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      include: {
        media: mediaInclude,
        participants: { include: { person: true } },
        collections: { select: { collection: { select: { personId: true } } } },
      },
    }),
  ]);

  const childIds = new Set(children.map((c) => c.id));
  const entries = await Promise.all(
    memories.map(async ({ collections, ...m }) => {
      const about = [
        ...m.participants.map((p) => p.personId),
        ...collections.map((c) => c.collection.personId),
      ].filter((id): id is string => id !== null && childIds.has(id));
      return { ...(await memoryCardDto(m)), childIds: [...new Set(about)] };
    }),
  );

  res.json({ children: children.map(personDto), memories: entries });
});
