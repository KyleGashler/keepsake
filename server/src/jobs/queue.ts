import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import type { JobQueue } from "./JobQueue.js";
import { PostgresJobQueue } from "./PostgresJobQueue.js";

let instance: JobQueue | null = null;

// Kept apart from the handlers so code they import (media-host/assets.ts) can enqueue without a cycle.
export function jobQueue(): JobQueue {
  if (!instance) instance = new PostgresJobQueue(prisma, { log: logger.child({ component: "jobs" }) });
  return instance;
}
