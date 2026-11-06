import type { Prisma } from "@prisma/client";
import type { Logger } from "pino";
import { errorMessage } from "../lib/errors.js";
import type { Palette } from "../lib/palette.js";
import { prisma } from "../lib/prisma.js";
import { hueForSeed } from "../lib/placeholder.js";
import { paletteOf } from "../lib/photo-derivatives.js";
import { MediaHostError, mediaHost } from "../media-host/index.js";
import { MEDIA_ORDER, canBeHero } from "../lib/serialize.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import { storage } from "../storage/index.js";
import type { JobHandler, JobQueue } from "./JobQueue.js";

// Pure recomputation from current rows, so safe to run any number of times.
export function memoryRefreshHandler(): JobHandler<"memory.refresh"> {
  return {
    async run({ familyId, memoryId }, ctx) {
      await refreshMemory(familyId, memoryId, ctx.log);
    },
    async onFinalFailure({ familyId, memoryId }, err, ctx) {
      ctx.log.warn({ memoryId, err }, "memory.refresh gave up");
      await refreshMemory(familyId, memoryId, ctx.log, { posterUnavailable: true });
    },
  };
}

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
      muxAsset: { select: { playbackId: true, status: true, durationS: true } },
      derivatives: { select: { kind: true, storageKey: true } },
    },
  },
} as const;

type RefreshMedia = Prisma.MemoryGetPayload<{ include: typeof refreshInclude }>["media"][number];
type Colours = Prisma.MemoryUpdateManyMutationInput;

// paletteOf reads a 64 px square; a little more keeps the resize honest.
const PALETTE_POSTER_WIDTH = 160;

// A video's colours change when it becomes READY without the hero changing,
// so the write guard compares both.
function heroKey(m: { id: string; type: string; muxAsset: { status: string } | null } | null) {
  return m ? `${m.id}:${m.type === "VIDEO" ? (m.muxAsset?.status ?? "") : ""}` : null;
}

export async function refreshMemory(
  familyId: string,
  memoryId: string,
  log: Logger,
  options: { posterUnavailable?: boolean } = {},
) {
  const memory = await prisma.memory.findFirst({ where: { id: memoryId, familyId }, include: refreshInclude });
  if (!memory) return;

  const hero = memory.media.find((m) => canBeHero(m)) ?? null;
  // Outside the transaction: storage and Mux may be slow.
  const colours = await heroColours(memory, hero, familyId, log, options.posterUnavailable ?? false);

  const captured = memory.media
    .flatMap((m) => (m.type === "PHOTO" && m.capturedAt ? [m.capturedAt] : []))
    .reduce<Date | null>((earliest, d) => (earliest && earliest <= d ? earliest : d), null);

  await prisma.$transaction(async (tx) => {
    // Under the memory's lock, which reorder and removal also take. If the hero
    // moved since it was read, that change queued its own refresh.
    await tx.$queryRaw`SELECT id FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
    const first = await tx.media.findMany({
      where: { memoryId },
      orderBy: MEDIA_ORDER,
      select: { id: true, type: true, muxAsset: { select: { playbackId: true, status: true } } },
    });
    const heroNow = heroKey(first.find((m) => canBeHero(m)) ?? null);
    if (colours && heroNow === heroKey(hero)) {
      await tx.memory.updateMany({ where: { id: memoryId, familyId }, data: colours });
      log.info(
        { memoryId, hero: hero?.id ?? null, heroType: hero?.type ?? null, hue: colours.paletteHue, analysis: colours.analysisStatus },
        "memory palette refreshed",
      );
    }
    if (captured) {
      // In the WHERE, not a read-then-write: a person's date saved a moment ago
      // (PATCH sets HUMAN) is never overwritten.
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

async function heroColours(
  memory: { palette: string[]; heroSeed: string; analysisStatus: string },
  hero: RefreshMedia | null,
  familyId: string,
  log: Logger,
  posterUnavailable: boolean,
): Promise<Colours | null> {
  const standIn = (analysisStatus: "PENDING" | "FAILED"): Colours | null =>
    memory.palette.length === 0 && memory.analysisStatus === analysisStatus
      ? null
      : { palette: [], paletteHue: hueForSeed(memory.heroSeed), brightness: 40 + (memory.heroSeed.length % 40), analysisStatus };

  if (hero?.type === "PHOTO") {
    const thumb = hero.derivatives.find((d) => d.kind === "THUMB");
    if (thumb && keyBelongsTo(thumb.storageKey, familyId)) {
      const pixels = await readAll(await storage().stream(thumb.storageKey));
      return readyColours(await paletteOf(pixels));
    }
    // An upload's media.derive refreshes again once its THUMB exists.
    return hero.storageKey ? null : standIn("PENDING");
  }

  const playbackId = hero?.muxAsset?.playbackId;
  if (hero?.type !== "VIDEO" || hero.muxAsset?.status !== "READY" || !playbackId) {
    // A video settling READY or FAILED queues another refresh.
    return standIn("PENDING");
  }
  if (posterUnavailable) return standIn("FAILED");

  const host = mediaHost();
  if (!host) {
    log.info({ mediaId: hero.id }, "memory.refresh: Mux not configured; video hero's colours left as they are");
    return null;
  }
  let poster: Buffer;
  try {
    poster = await host.fetchPoster(playbackId, hero.muxAsset.durationS, PALETTE_POSTER_WIDTH);
  } catch (err) {
    if (err instanceof MediaHostError && !err.retryable) {
      log.warn({ mediaId: hero.id, err: err.message }, "video poster can't be read; keeping the stand-in's colours");
      return standIn("FAILED");
    }
    throw err;
  }
  try {
    return readyColours(await paletteOf(poster));
  } catch (err) {
    log.warn({ mediaId: hero.id, err: errorMessage(err) }, "video poster isn't a readable image");
    return standIn("FAILED");
  }
}

function readyColours(p: Palette): Colours {
  return { palette: p.swatches, paletteHue: p.hue, brightness: p.brightness, analysisStatus: "READY" };
}

// Unbounded: callers bound the size first.
export async function readAll(source: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
