import type { Memory } from "@prisma/client";
import { Router } from "express";
import { isNeutralPalette } from "../lib/palette.js";
import { prisma } from "../lib/prisma.js";
import { heroStill, imageUrl, mediaInclude } from "../lib/serialize.js";

export const mosaicRouter = Router();

mosaicRouter.get("/mosaic", async (req, res) => {
  const family = req.ctx.family;
  const memories = await prisma.memory.findMany({
    where: { familyId: family.id },
    // The database's order is only the tie-break for equal colours.
    orderBy: [{ paletteHue: "asc" }, { brightness: "desc" }, { id: "asc" }],
    include: { media: mediaInclude },
  });
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; ES2022 has no toSorted
  const ordered = memories.map((m) => ({ m, key: colourKey(m) })).sort((a, b) => compareKeys(a.key, b.key));

  const tiles = await Promise.all(
    ordered.map(async ({ m }, i) => {
      // DISPLAY, not THUMB: a tile spans up to a column and a half of a phone, past 400 px.
      const hero = await heroStill(m.media, "DISPLAY");
      const span = tileSpan(i);
      return {
        id: m.id,
        title: m.title,
        occurredAt: m.occurredAt.toISOString(),
        url: hero?.url ?? imageUrl(m.heroSeed, 900, 900),
        isVideo: hero?.media.type === "VIDEO",
        hasAudio: m.media.some((x) => x.type === "AUDIO"),
        paletteHue: m.paletteHue,
        palette: m.palette,
        span,
      };
    }),
  );

  res.json({ tiles });
});

type ColourKey = { neutral: boolean; hue: number; brightness: number };

function colourKey(m: Pick<Memory, "palette" | "paletteHue" | "brightness">): ColourKey {
  return { neutral: isNeutralPalette(m.palette), hue: m.paletteHue, brightness: m.brightness };
}

function compareKeys(a: ColourKey, b: ColourKey) {
  if (a.neutral !== b.neutral) return a.neutral ? 1 : -1;
  if (!a.neutral && a.hue !== b.hue) return a.hue - b.hue;
  return b.brightness - a.brightness;
}

function tileSpan(index: number) {
  const beat = index % 7;
  if (beat === 0) return "wide";
  if (beat === 3) return "tall";
  return "single";
}
