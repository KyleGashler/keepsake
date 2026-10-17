import type { Prisma, PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import {
  PermanentJobError,
  type EnqueueOptions,
  type JobContext,
  type JobHandler,
  type JobPayloads,
  type JobQueue,
  type JobType,
} from "./JobQueue.js";

export interface PostgresJobQueueOptions {
  log: Logger;
  /** Jobs this process runs at once. */
  concurrency?: number;
  /** How long an idle loop waits before looking again. */
  pollIntervalMs?: number;
  /**
   * A RUNNING job whose lock is older than this is presumed orphaned (its
   * worker died or was redeployed mid-run) and is claimed again. Must be
   * comfortably longer than any handler takes.
   */
  staleAfterMs?: number;
  /** First retry delay; doubles per attempt, capped at `backoffMaxMs`. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

type ClaimedJob = {
  id: string;
  type: JobType;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  /** Doubles as the lock token: every write back requires it unchanged. */
  lockedAt: Date;
};

/**
 * The `Job` table as a queue.
 *
 * Claiming is one statement: pick the oldest due row with
 * `FOR UPDATE SKIP LOCKED` (so concurrent workers never block on, or take,
 * each other's rows) and flip it to RUNNING in the same breath. The claim
 * counts as an attempt, so a job that kills its worker every time still runs
 * out of attempts.
 *
 * Timestamps are written as UTC on the database side: Prisma stores
 * `DateTime` as `timestamp(3)` in UTC, and `now() AT TIME ZONE 'UTC'` keeps
 * raw SQL in agreement whatever the session's time zone is.
 */
export class PostgresJobQueue implements JobQueue {
  private readonly handlers = new Map<JobType, JobHandler<JobType>>();
  private readonly sleepers = new Set<() => void>();
  private loops: Promise<void>[] = [];
  private running = false;

  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly log: Logger;

  constructor(
    private readonly db: PrismaClient,
    options: PostgresJobQueueOptions,
  ) {
    this.log = options.log;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
    this.backoffBaseMs = options.backoffBaseMs ?? 15_000;
    this.backoffMaxMs = options.backoffMaxMs ?? 15 * 60 * 1000;
  }

  async enqueue<T extends JobType>(type: T, payload: JobPayloads[T], options: EnqueueOptions = {}) {
    const job = await (options.db ?? this.db).job.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonObject,
        ...(options.runAt ? { runAt: options.runAt } : {}),
        ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
      },
      select: { id: true },
    });
    return job;
  }

  register<T extends JobType>(type: T, handler: JobHandler<T>) {
    if (this.running) throw new Error(`register("${type}") after start()`);
    this.handlers.set(type, handler as unknown as JobHandler<JobType>);
  }

  start() {
    if (this.running) return;
    if (this.handlers.size === 0) throw new Error("JobQueue.start() with no handlers registered");
    this.running = true;
    this.loops = Array.from({ length: this.concurrency }, () => this.loop());
    this.log.info({ types: [...this.handlers.keys()], concurrency: this.concurrency }, "job worker started");
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    for (const wake of this.sleepers) wake();
    await Promise.all(this.loops);
    this.loops = [];
    this.log.info("job worker stopped");
  }

  private async loop() {
    while (this.running) {
      let job: ClaimedJob | null;
      try {
        job = await this.claim();
      } catch (err) {
        // Database blip: back off rather than spin, and keep the loop alive.
        this.log.error({ err }, "job claim failed");
        await this.sleep(this.pollIntervalMs * 5);
        continue;
      }
      if (!job) {
        await this.sleep(this.pollIntervalMs);
        continue;
      }
      await this.execute(job);
    }
  }

  private async claim(): Promise<ClaimedJob | null> {
    const types = [...this.handlers.keys()];
    const staleSeconds = this.staleAfterMs / 1000;
    const rows = await this.db.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" AS j
      SET status = 'RUNNING',
          "lockedAt" = now() AT TIME ZONE 'UTC',
          attempts = j.attempts + 1,
          "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE j.id = (
        SELECT id FROM "Job"
        WHERE type = ANY(${types}::text[])
          AND (
            (status = 'QUEUED' AND "runAt" <= now() AT TIME ZONE 'UTC')
            OR (status = 'RUNNING' AND "lockedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${staleSeconds}::double precision))
          )
        ORDER BY "runAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING j.id, j.type, j.payload, j.attempts, j."maxAttempts", j."lockedAt"`;
    return rows[0] ?? null;
  }

  private async execute(job: ClaimedJob) {
    const handler = this.handlers.get(job.type);
    const log = this.log.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const ctx: JobContext = {
      id: job.id,
      type: job.type,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      log,
    };
    const payload = job.payload as unknown as JobPayloads[JobType];

    if (!handler) return; // unreachable: claim filters by registered type

    // Only a job recovered from a dead worker can get here: its last
    // permitted attempt was spent by the run that never reported back.
    if (job.attempts > job.maxAttempts) {
      await this.giveUp(job, handler, payload, new Error("Worker stopped during the final attempt"), ctx);
      return;
    }

    const started = Date.now();
    try {
      await handler.run(payload, ctx);
    } catch (err) {
      if (err instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
        await this.giveUp(job, handler, payload, err, ctx);
      } else {
        await this.retryLater(job, err, log);
      }
      return;
    }

    const done = await this.db.job.updateMany({
      where: { id: job.id, lockedAt: job.lockedAt },
      data: { status: "SUCCEEDED", lockedAt: null, lastError: null },
    });
    if (done.count === 0) log.warn("job finished after its lock was taken over; result kept, status left to the new owner");
    log.info({ ms: Date.now() - started }, "job succeeded");
  }

  private async retryLater(job: ClaimedJob, err: unknown, log: Logger) {
    const exp = this.backoffBaseMs * 2 ** (job.attempts - 1);
    // ±20% jitter so a burst of failures doesn't retry in lockstep.
    const delay = Math.min(this.backoffMaxMs, exp) * (0.8 + Math.random() * 0.4);
    const runAt = new Date(Date.now() + delay);
    await this.db.job.updateMany({
      where: { id: job.id, lockedAt: job.lockedAt },
      data: { status: "QUEUED", lockedAt: null, runAt, lastError: describe(err) },
    });
    log.warn({ err, retryAt: runAt.toISOString() }, "job failed; will retry");
  }

  private async giveUp(
    job: ClaimedJob,
    handler: JobHandler<JobType>,
    payload: JobPayloads[JobType],
    err: unknown,
    ctx: JobContext,
  ) {
    const failed = await this.db.job.updateMany({
      where: { id: job.id, lockedAt: job.lockedAt },
      data: { status: "FAILED", lockedAt: null, lastError: describe(err) },
    });
    ctx.log.error({ err }, "job failed permanently");
    if (failed.count === 0 || !handler.onFinalFailure) return;
    try {
      await handler.onFinalFailure(payload, err, ctx);
    } catch (hookErr) {
      ctx.log.error({ err: hookErr }, "onFinalFailure hook threw");
    }
  }

  /** A wait that `stop()` can cut short. */
  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }
}

function describe(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 2000);
}
