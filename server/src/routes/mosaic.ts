import type { Memory } from "@prisma/client";
import { Router } from "express";
import { isNeutralPalette } from "../lib/palette.js";
import { prisma } from "../lib/prisma.js";
import { heroStill, imageUrl, mediaInclude } from "../lib/serialize.js";

export const mosaicRouter = Router();

/**
 * Mosaic presents the archive by colour rather than by date. A memory's
 * colour is its hero photo's palette (A6: `memory.refresh` reads it from the
 * photo itself); memories without a derived photo keep their generated
 * stand-in's hue, which is the picture they show. Tiles run round the colour
 * wheel by hue, lighter first within a hue; black-and-white photos, which
 * have no hue worth the name, gather at the end from light to dark.
 */
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
      // A photo's DISPLAY rendition or a video's poster frame, never the
      // video (see serialize.ts#stillUrl). Tiles span up to a column and a
      // half of a phone, past what a 400 px THUMB covers.
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
        /** The hero photo's colours, most of the picture first; empty until read. */
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

/** A repeating 7-beat rhythm: mostly small tiles, occasional wide/tall ones. */
function tileSpan(index: number) {
  const beat = index % 7;
  if (beat === 0) return "wide";
  if (beat === 3) return "tall";
  return "single";
}
