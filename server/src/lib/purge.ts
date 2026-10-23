import type { Prisma } from "@prisma/client";
import type { JobPayloads, JobQueue } from "../jobs/JobQueue.js";
import { lockAssets } from "../media-host/assets.js";

/**
 * Hard delete, and what it leaves to clean up (A7: no trash, no restore).
 *
 * When a family deletes a memory, removes a photo or clip from one, or
 * deletes a person, the rows go at once, in the request, and the files go
 * afterwards in a `media.purge` job: S3 (or local disk) originals and their
 * derivatives through `StorageProvider.purgeForFamilyDelete`, and the Mux
 * asset through `MediaHost.deleteAsset` (or `cancelUpload` if there is no
 * asset yet). The request never waits on S3 or Mux, and a slow or failing
 * provider is retried by the queue rather than lost.
 *
 * The rows are gone by the time the job runs, so the payload carries every
 * key and id it needs. A MuxAsset row is dropped (and its asset purged) only
 * once no Media links to it any more.
 *
 * This is the only path that deletes an original or a Mux asset. The app
 * never does either on its own; A16's account deletion will reuse it.
 */

export type PurgePayload = JobPayloads["media.purge"];

/**
 * Tries before a purge is left FAILED. The queue backs off 15 s doubling to a
 * 15-minute cap, so this is roughly four hours of trying. A FAILED job keeps
 * its payload on the Job row: re-queue it (status QUEUED, attempts 0) once
 * whatever was refusing is fixed.
 */
export const PURGE_MAX_ATTEMPTS = 20;

const purgeMediaSelect = {
  storageKey: true,
  muxAssetId: true,
  derivatives: { select: { storageKey: true } },
} as const;

/**
 * Delete rows and enqueue the purge of their files, in the caller's
 * transaction (so the job exists if and only if the delete commits).
 *
 * - `media`: the Media rows the delete will take with it (directly, or by
 *   cascade from their memory). Read before `remove` runs.
 * - `extraKeys`: other storage keys that become unreferenced — a deleted
 *   person's profile photo.
 * - `remove`: the delete itself.
 *
 * Lock order matches every other writer (MuxAsset rows, then Memory/Media),
 * so a webhook settling one of these clips can't deadlock with the delete.
 * Returns the payload enqueued, or null when there was nothing to purge.
 */
export async function deleteAndPurge(
  tx: Prisma.TransactionClient,
  queue: JobQueue,
  input: {
    familyId: string;
    reason: string;
    media?: Prisma.MediaWhereInput;
    extraKeys?: (string | null | undefined)[];
  },
  remove: () => Promise<unknown>,
): Promise<PurgePayload | null> {
  const media = input.media ? await tx.media.findMany({ where: input.media, select: purgeMediaSelect }) : [];
  const muxIds = unique(media.map((m) => m.muxAssetId));
  await lockAssets(tx, muxIds);

  await remove();

  const muxAssets: PurgePayload["muxAssets"] = [];
  if (muxIds.length) {
    // Another memory may link the same upload; only an asset nothing shows
    // any more is purged.
    const stillLinked = new Set(
      (
        await tx.media.findMany({
          where: { muxAssetId: { in: muxIds } },
          select: { muxAssetId: true },
          distinct: ["muxAssetId"],
        })
      ).map((m) => m.muxAssetId),
    );
    const orphans = await tx.muxAsset.findMany({
      where: { id: { in: muxIds.filter((id) => !stillLinked.has(id)) }, familyId: input.familyId },
    });
    if (orphans.length) {
      await tx.muxAsset.deleteMany({ where: { id: { in: orphans.map((a) => a.id) } } });
      for (const a of orphans) muxAssets.push({ uploadId: a.uploadId, assetId: a.assetId });
    }
  }

  const storageKeys = unique([
    ...media.flatMap((m) => [m.storageKey, ...m.derivatives.map((d) => d.storageKey)]),
    ...(input.extraKeys ?? []),
  ]);
  if (storageKeys.length === 0 && muxAssets.length === 0) return null;

  const payload: PurgePayload = { familyId: input.familyId, storageKeys, muxAssets, reason: input.reason };
  await queue.enqueue("media.purge", payload, { db: tx, maxAttempts: PURGE_MAX_ATTEMPTS });
  return payload;
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
