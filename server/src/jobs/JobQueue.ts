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
  /**
   * Bring one MuxAsset row up to date by asking Mux, and look again later
   * until it settles. `startedAt` (epoch ms) is when this chain of looks
   * began; polling gives up a fixed time after it.
   */
  "mux.sync": { muxAssetId: string; startedAt: number };
  /**
   * Remove for good the files behind rows a family just deleted. The rows
   * are already gone when this runs, so the payload carries everything: the
   * storage keys (originals and derivatives) and each Mux upload with its
   * asset id, if it had one yet. See lib/purge.ts.
   */
  "media.purge": {
    familyId: string;
    storageKeys: string[];
    muxAssets: { uploadId: string; assetId: string | null }[];
    /** What was deleted, for the log: "memory", "media", "person", "family". */
    reason: string;
    /**
     * The family itself was deleted (A16): purge every object under
     * `<familyId>/` too, referenced or not — uploads that never finalized
     * included. `storageKeys` is then empty, since the prefix covers them.
     */
    wholeFamily?: boolean;
  };
}

export type JobType = keyof JobPayloads;

const purgedClip = z.object({ uploadId: z.string(), assetId: z.string().nullable() });

/**
 * A payload comes back from the database as untyped JSON, so the queue checks
 * it against its type's schema before a handler sees it.
 */
export const jobPayloadSchemas: { [T in JobType]: z.ZodType<JobPayloads[T]> } = {
  "mux.sync": z.object({ muxAssetId: z.string(), startedAt: z.number() }),
  "media.purge": z.object({
    familyId: z.string(),
    storageKeys: z.array(z.string()),
    muxAssets: z.array(purgedClip),
    reason: z.string(),
    wholeFamily: z.boolean().optional(),
  }),
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
