import type { Prisma } from "@prisma/client";
import type { Logger } from "pino";
import { z } from "zod";

export interface JobPayloads {
  // `startedAt` is epoch ms, when this chain of polls began.
  "mux.sync": { muxAssetId: string; startedAt: number };
  "media.purge": {
    familyId: string;
    storageKeys: string[];
    muxAssets: { uploadId: string; assetId: string | null }[];
    reason: string;
    // Purges every object under `<familyId>/`, unfinalized uploads included; `storageKeys` is then empty.
    wholeFamily?: boolean;
  };
  "media.derive": { familyId: string; mediaId: string };
  "image.derive": { familyId: string; storageKey: string };
  "memory.refresh": { familyId: string; memoryId: string };
}

export type JobType = keyof JobPayloads;

// A `media.purge` must not be lost: backoff doubles from 15 s to a 15-minute cap, so 20 tries is about four hours.
export const MAX_ATTEMPTS: Partial<Record<JobType, number>> = { "media.purge": 20 };

const purgedClip = z.object({ uploadId: z.string(), assetId: z.string().nullable() });

export const jobPayloadSchemas: { [T in JobType]: z.ZodType<JobPayloads[T]> } = {
  "mux.sync": z.object({ muxAssetId: z.string(), startedAt: z.number() }),
  "media.purge": z.object({
    familyId: z.string(),
    storageKeys: z.array(z.string()),
    muxAssets: z.array(purgedClip),
    reason: z.string(),
    wholeFamily: z.boolean().optional(),
  }),
  "media.derive": z.object({ familyId: z.string(), mediaId: z.string() }),
  "image.derive": z.object({ familyId: z.string(), storageKey: z.string() }),
  "memory.refresh": z.object({ familyId: z.string(), memoryId: z.string() }),
};

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  db?: Prisma.TransactionClient;
}

export interface JobContext {
  id: string;
  type: JobType;
  // 1 on the first run.
  attempt: number;
  maxAttempts: number;
  log: Logger;
}

export interface JobHandler<T extends JobType = JobType> {
  run: (payload: JobPayloads[T], ctx: JobContext) => Promise<void>;
  onFinalFailure?: (payload: JobPayloads[T], error: unknown, ctx: JobContext) => Promise<void>;
}

export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

export interface JobQueue {
  enqueue: <T extends JobType>(type: T, payload: JobPayloads[T], options?: EnqueueOptions) => Promise<{ id: string }>;
  // Register before `start()`: only registered types are claimed.
  register: <T extends JobType>(type: T, handler: JobHandler<T>) => void;
  start: () => void;
  stop: () => Promise<void>;
}
