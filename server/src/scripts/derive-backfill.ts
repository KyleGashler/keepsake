// npm run media:derive-backfill -- [--dry-run] [--wait] [--family <id>]
// Use --wait on Fly: the machine suspends when no HTTP request holds it awake, and an SSH session doesn't count.
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
