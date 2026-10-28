import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import type { JobQueue } from "./JobQueue.js";
import { mediaDeriveHandler } from "./media-derive.js";
import { mediaPurgeHandler } from "./media-purge.js";
import { memoryRefreshHandler } from "./memory-refresh.js";
import { muxSyncHandler } from "./mux-sync.js";
import { PostgresJobQueue, type PostgresJobQueueOptions } from "./PostgresJobQueue.js";
import { jobQueue } from "./queue.js";

export { PermanentJobError } from "./JobQueue.js";
export type { JobQueue, JobPayloads, JobType } from "./JobQueue.js";
export { jobQueue };

export type WorkerOptions = Partial<Omit<PostgresJobQueueOptions, "log">>;

/**
 * Register every handler and start polling. Called by `worker.ts`, or by the
 * API itself when `WORKER_INLINE=1`. Returns the queue so the caller can
 * `stop()` it on shutdown.
 */
export function startWorker(options: WorkerOptions = {}): JobQueue {
  const queue =
    Object.keys(options).length > 0
      ? new PostgresJobQueue(prisma, { log: logger.child({ component: "jobs" }), ...options })
      : jobQueue();
  queue.register("mux.sync", muxSyncHandler(queue));
  queue.register("media.purge", mediaPurgeHandler());
  queue.register("media.derive", mediaDeriveHandler(queue));
  queue.register("memory.refresh", memoryRefreshHandler());
  queue.start();
  return queue;
}
