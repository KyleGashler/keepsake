import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { imageUrl, mediaReadUrl } from "../lib/serialize.js";

export const mosaicRouter = Router();

/**
 * Mosaic presents the archive aesthetically rather than chronologically.
 * Real palette/composition analysis belongs to the AI phase; for now we sort by
 * the stored hue + brightness and vary tile size to create a curated rhythm.
 */
mosaicRouter.get("/mosaic", async (req, res) => {
  const family = req.ctx.family;
  const memories = await prisma.memory.findMany({
    where: { familyId: family.id },
    orderBy: [{ paletteHue: "asc" }, { brightness: "desc" }],
    include: { media: true },
  });

  const tiles = await Promise.all(memories.map(async (m, i) => {
    const hero = m.media.find((x) => x.type === "PHOTO" || x.type === "VIDEO");
    const span = tileSpan(i);
    return {
      id: m.id,
      title: m.title,
      occurredAt: m.occurredAt.toISOString(),
      url: hero ? await mediaReadUrl(hero) : imageUrl(m.heroSeed, 900, 900),
      isVideo: hero?.type === "VIDEO",
      hasAudio: m.media.some((x) => x.type === "AUDIO"),
      paletteHue: m.paletteHue,
      span,
    };
  }));

  res.json({ tiles });
});

/** A repeating 7-beat rhythm: mostly small tiles, occasional wide/tall ones. */
function tileSpan(index: number) {
  const beat = index % 7;
  if (beat === 0) return "wide";
  if (beat === 3) return "tall";
  return "single";
}
