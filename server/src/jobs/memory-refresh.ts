import type { Prisma } from "@prisma/client";
import type { Logger } from "pino";
import { prisma } from "../lib/prisma.js";
import { hueForSeed } from "../lib/placeholder.js";
import { paletteOf } from "../lib/photo-derivatives.js";
import { MEDIA_ORDER, canBeHero } from "../lib/serialize.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { storage } from "../storage/index.js";
import type { JobHandler, JobQueue } from "./JobQueue.js";

/**
 * `memory.refresh`: re-read what a memory takes from its photos (A6).
 *
 * - **Palette** (`palette`, `paletteHue`, `brightness`; Mosaic sorts by
 *   these) from the hero's THUMB — the first photo or posterable video in
 *   the family's order, the same choice the DTOs make. A photo hero not yet
 *   derived is left for its `media.derive`, which refreshes when it's done.
 *   A video hero, or none, puts back the generated stand-in's values (the
 *   picture a card then shows) if a photo's palette was there.
 * - **Date**: unless a person set it (`occurredAtSource` HUMAN), the
 *   memory's date is the earliest EXIF capture day among its photos.
 *
 * Enqueued when the hero may have changed (reorder, removal) and called by
 * `media.derive` once a photo's renditions exist. Pure recomputation from
 * current rows, so it's safe to run any number of times.
 */
export function memoryRefreshHandler(): JobHandler<"memory.refresh"> {
  return {
    async run({ familyId, memoryId }, ctx) {
      await refreshMemory(familyId, memoryId, ctx.log);
    },
  };
}

/** At most one waiting refresh per memory: a burst of reorders reads the end state once. */
export async function kickRefresh(
  queue: JobQueue,
  familyId: string,
  memoryId: string,
  db: Prisma.TransactionClient = prisma,
) {
  const waiting = await db.job.count({
    where: { type: "memory.refresh", status: "QUEUED", payload: { path: ["memoryId"], equals: memoryId } },
  });
  if (waiting === 0) await queue.enqueue("memory.refresh", { familyId, memoryId }, { db });
}

const refreshInclude = {
  media: {
    orderBy: MEDIA_ORDER,
    select: {
      id: true,
      type: true,
      storageKey: true,
      capturedAt: true,
      muxAsset: { select: { playbackId: true, status: true } },
      derivatives: { select: { kind: true, storageKey: true } },
    },
  },
} as const;

export async function refreshMemory(familyId: string, memoryId: string, log: Logger) {
  const memory = await prisma.memory.findFirst({ where: { id: memoryId, familyId }, include: refreshInclude });
  if (!memory) return; // deleted since; nothing to do

  const hero = memory.media.find((m) => canBeHero(m)) ?? null;
  const thumb = hero?.type === "PHOTO" ? hero.derivatives.find((d) => d.kind === "THUMB") : undefined;

  // Read the pixels outside the transaction: storage may be slow.
  let colours: Prisma.MemoryUpdateManyMutationInput | null = null;
  if (thumb && keyBelongsTo(thumb.storageKey, familyId)) {
    const p = await paletteOf(await readAll(await storage().stream(thumb.storageKey)));
    colours = { palette: p.swatches, paletteHue: p.hue, brightness: p.brightness, analysisStatus: "READY" };
  } else if (hero?.type === "PHOTO" && hero.storageKey) {
    colours = null; // its media.derive will be back
  } else if (memory.palette.length > 0) {
    // The photo that gave the palette is no longer the hero, and nothing
    // derived took its place: back to the stand-in's values, as at creation.
    colours = {
      palette: [],
      paletteHue: hueForSeed(memory.heroSeed),
      brightness: 40 + (memory.heroSeed.length % 40),
    };
  }

  const captured = memory.media
    .flatMap((m) => (m.type === "PHOTO" && m.capturedAt ? [m.capturedAt] : []))
    .reduce<Date | null>((earliest, d) => (earliest && earliest <= d ? earliest : d), null);

  await prisma.$transaction(async (tx) => {
    // Under the memory's lock (which reorder and removal also take) check the
    // hero is still the one the palette came from. If it moved, that change
    // queued its own refresh, which will read the new one.
    await tx.$queryRaw`SELECT id FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
    const first = await tx.media.findMany({
      where: { memoryId },
      orderBy: MEDIA_ORDER,
      select: { id: true, type: true, muxAsset: { select: { playbackId: true, status: true } } },
    });
    const heroNow = first.find((m) => canBeHero(m))?.id ?? null;
    if (colours && heroNow === (hero?.id ?? null)) {
      await tx.memory.updateMany({ where: { id: memoryId, familyId }, data: colours });
      log.info({ memoryId, hero: hero?.id ?? null, hue: colours.paletteHue }, "memory palette refreshed");
    }
    if (captured) {
      // In the WHERE, not a read-then-write: a person's date saved a moment
      // ago (PATCH sets HUMAN) is never overwritten.
      const moved = await tx.memory.updateMany({
        where: {
          id: memoryId,
          familyId,
          occurredAtSource: { not: "HUMAN" },
          OR: [{ occurredAt: { not: captured } }, { occurredAtSource: { not: "EXIF" } }],
        },
        data: { occurredAt: captured, occurredAtSource: "EXIF" },
      });
      if (moved.count) log.info({ memoryId, occurredAt: captured.toISOString() }, "memory dated from EXIF");
    }
  });
}

/** A stream into one buffer. Callers bound the size first. */
export async function readAll(source: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
