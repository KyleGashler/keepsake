/**
 * One-off (A6): queue `media.derive` for every uploaded photo that doesn't
 * have both its THUMB and DISPLAY yet — the photos uploaded before the job
 * existed. Each run's `memory.refresh` then gives its memory a real palette.
 *
 *   npm run media:derive-backfill -- --dry-run   # count what would be queued
 *   npm run media:derive-backfill                # queue; a worker runs them
 *   npm run media:derive-backfill -- --wait      # queue, then run a worker here until they're done
 *
 * On Fly (compiled):
 *   fly ssh console -C "sh -c 'cd /app && node dist/scripts/derive-backfill.js --wait'"
 *
 * `--wait` matters there: the API's inline worker would pick the jobs up
 * too, but the machine suspends when no HTTP request holds it awake, and an
 * SSH session doesn't count. Running a worker in the script keeps the work
 * going for as long as the session lasts (the two workers share the queue
 * safely — SKIP LOCKED). `--family <id>` limits it to one family.
 *
 * Idempotent: a photo with a `media.derive` already waiting or running is
 * skipped, and the job itself skips a photo that has both renditions. Dates:
 * memories made before A6 have `occurredAtSource` HUMAN, so the backfill
 * fills `Media.capturedAt` but moves no memory's date.
 */
import type { Prisma } from "@prisma/client";
import { jobQueue, startWorker } from "../jobs/index.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { PHOTO_DERIVATIVE_KINDS } from "../storage/index.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const wait = args.includes("--wait");
const familyAt = args.indexOf("--family");
const familyId = familyAt === -1 ? undefined : args[familyAt + 1];
if (familyAt !== -1 && !familyId) throw new Error("--family needs a family id");

async function main() {
  const where: Prisma.MediaWhereInput = {
    type: "PHOTO",
    storageKey: { not: null },
    // Missing either rendition (a run that died between the two writes
    // leaves no rows at all, but be exact).
    OR: PHOTO_DERIVATIVE_KINDS.map((kind) => ({ derivatives: { none: { kind } } })),
    ...(familyId ? { memory: { familyId } } : {}),
  };
  const photos = await prisma.media.findMany({
    where,
    select: { id: true, memory: { select: { familyId: true } } },
    orderBy: { createdAt: "asc" },
  });

  const pending = await prisma.job.findMany({
    where: { type: "media.derive", status: { in: ["QUEUED", "RUNNING"] } },
    select: { payload: true },
  });
  const waiting = new Set(pending.flatMap((j) => queuedMediaId(j.payload)));
  const todo = photos.filter((p) => !waiting.has(p.id));

  logger.info({ photos: photos.length, alreadyQueued: photos.length - todo.length, toQueue: todo.length, dryRun }, "derive backfill");
  if (dryRun || todo.length === 0) return;

  const queue = jobQueue();
  const ids: string[] = [];
  for (const p of todo) {
    const job = await queue.enqueue("media.derive", { familyId: p.memory.familyId, mediaId: p.id });
    ids.push(job.id);
  }
  logger.info({ queued: ids.length }, "derive backfill queued");
  if (!wait) return;

  const worker = startWorker();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const counts = await prisma.job.groupBy({ by: ["status"], where: { id: { in: ids } }, _count: true });
    const by = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    logger.info(by, "derive backfill progress");
    if (!by.QUEUED && !by.RUNNING) break;
  }
  await worker.stop();
}

/** The photo a queued `media.derive` is for, read defensively (it's JSON). */
function queuedMediaId(payload: Prisma.JsonValue): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const id = payload.mediaId;
  return typeof id === "string" ? [id] : [];
}

void main()
  .catch((err: unknown) => {
    logger.error({ err }, "derive backfill failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
