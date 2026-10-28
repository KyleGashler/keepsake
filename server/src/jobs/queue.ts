import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import type { JobQueue } from "./JobQueue.js";
import { PostgresJobQueue } from "./PostgresJobQueue.js";

let instance: JobQueue | null = null;

/**
 * The process-wide queue. Routes only enqueue through it; handlers are
 * registered and polling starts only where `startWorker` (./index.ts) runs.
 *
 * Its own module, apart from the handlers, so code the handlers import (the
 * Mux row merges in media-host/assets.ts) can enqueue without a cycle.
 */
export function jobQueue(): JobQueue {
  if (!instance) instance = new PostgresJobQueue(prisma, { log: logger.child({ component: "jobs" }) });
  return instance;
}
