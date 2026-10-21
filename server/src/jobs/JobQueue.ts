import type { Prisma } from "@prisma/client";
import type { Logger } from "pino";
import { z } from "zod";

/**
 * Durable background work.
 *
 * A route enqueues a typed job; a worker — in its own process (`worker.ts`) or
 * inside the API when `WORKER_INLINE=1` — claims it, runs the registered
 * handler, and retries with backoff when the handler throws. The queue is the
 * only thing that knows how jobs are stored; handlers only see their payload.
 *
 * New job types are added by extending `JobPayloads`, giving the payload a
 * schema in `jobPayloadSchemas`, and registering a handler in `jobs/index.ts`.
 */
export interface JobPayloads {
  /** Speech-to-text for one AUDIO or VIDEO clip. */
  "ai.transcribe": { mediaId: string };
}

export type JobType = keyof JobPayloads;

/**
 * A payload comes back from the database as untyped JSON, so the queue checks
 * it against its type's schema before a handler sees it.
 */
export const jobPayloadSchemas: { [T in JobType]: z.ZodType<JobPayloads[T]> } = {
  "ai.transcribe": z.object({ mediaId: z.string() }),
};

export interface EnqueueOptions {
  /** Not before this time. Defaults to now. */
  runAt?: Date;
  /** Attempts before the job is marked FAILED. Defaults to the column's 5. */
  maxAttempts?: number;
  /**
   * Enqueue inside the caller's transaction, so a job exists if and only if
   * the rows it refers to were committed.
   */
  db?: Prisma.TransactionClient;
}

export interface JobContext {
  id: string;
  type: JobType;
  /** 1 on the first run. */
  attempt: number;
  maxAttempts: number;
  log: Logger;
}

export interface JobHandler<T extends JobType = JobType> {
  run: (payload: JobPayloads[T], ctx: JobContext) => Promise<void>;
  /**
   * Called once when the job is given up on — retries exhausted, or a
   * `PermanentJobError`. The place to record the failure on the domain row.
   * A throw here is logged, never retried.
   */
  onFinalFailure?: (payload: JobPayloads[T], error: unknown, ctx: JobContext) => Promise<void>;
}

/**
 * Thrown by a handler when retrying cannot help (bad input, a 4xx from a
 * provider). The job goes straight to FAILED.
 */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

export interface JobQueue {
  enqueue: <T extends JobType>(type: T, payload: JobPayloads[T], options?: EnqueueOptions) => Promise<{ id: string }>;
  /** Register before `start()`. Only registered types are claimed. */
  register: <T extends JobType>(type: T, handler: JobHandler<T>) => void;
  /** Begin polling. Idempotent. */
  start: () => void;
  /** Stop claiming new jobs and wait for the ones in flight to finish. */
  stop: () => Promise<void>;
}
