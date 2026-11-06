// The API runs the same worker in-process when WORKER_INLINE=1. Running both is safe: claims use SKIP LOCKED.
import { startWorker } from "./jobs/index.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { storage } from "./storage/index.js";

// Fail at boot, not on the first job, if storage is misconfigured.
storage();

const queue = startWorker();

let stopping = false;
async function shutdown(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "worker shutting down");
  const forceExit = setTimeout(() => {
    logger.error("worker shutdown timed out after 30s — forcing exit");
    process.exit(1);
  }, 30_000);
  forceExit.unref();
  try {
    await queue.stop();
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, "error during worker shutdown");
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
