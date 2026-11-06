import type { Prisma } from "@prisma/client";
import type { JobPayloads, JobQueue } from "../jobs/JobQueue.js";
import { lockAssets } from "../media-host/assets.js";
import { UPLOAD_URL_TTL_SECONDS } from "../storage/StorageProvider.js";

export type PurgePayload = JobPayloads["media.purge"];

const purgeMediaSelect = {
  storageKey: true,
  muxAssetId: true,
} as const;

// Lock order matches every other writer (MuxAsset rows, then Memory/Media)
// so a webhook settling one of these clips can't deadlock with the delete.
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
    ...media.map((m) => m.storageKey),
    ...(input.extraKeys ?? []),
  ]);
  if (storageKeys.length === 0 && muxAssets.length === 0) return null;

  const payload: PurgePayload = { familyId: input.familyId, storageKeys, muxAssets, reason: input.reason };
  await queue.enqueue("media.purge", payload, { db: tx });
  return payload;
}

// Outlives any upload URL issued before the delete, plus slack for a PUT already in flight.
export const LATE_UPLOAD_SWEEP_MS = (UPLOAD_URL_TTL_SECONDS + 15 * 60) * 1000;

// Lock order: the family's MuxAsset rows (as every other writer), then the
// Family row FOR UPDATE, which blocks inserts referencing it until the cascade.
export async function deleteFamilyAndPurge(
  tx: Prisma.TransactionClient,
  queue: JobQueue,
  input: { familyId: string; reason: string },
): Promise<boolean> {
  const { familyId } = input;
  const before = await tx.muxAsset.findMany({ where: { familyId }, select: { id: true } });
  await lockAssets(
    tx,
    before.map((a) => a.id),
  );

  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Family" WHERE id = ${familyId} FOR UPDATE`;
  if (locked.length === 0) return false;

  const known = new Set(before.map((a) => a.id));
  const assets = await tx.muxAsset.findMany({ where: { familyId }, select: { id: true, uploadId: true, assetId: true } });
  await lockAssets(
    tx,
    assets.filter((a) => !known.has(a.id)).map((a) => a.id),
  );

  await tx.family.delete({ where: { id: familyId } });

  const muxAssets = assets.map((a) => ({ uploadId: a.uploadId, assetId: a.assetId }));
  const payload: PurgePayload = { familyId, storageKeys: [], muxAssets, reason: input.reason, wholeFamily: true };
  await queue.enqueue("media.purge", payload, { db: tx });
  await queue.enqueue(
    "media.purge",
    { familyId, storageKeys: [], muxAssets: [], reason: `${input.reason} (late uploads)`, wholeFamily: true },
    { db: tx, runAt: new Date(Date.now() + LATE_UPLOAD_SWEEP_MS) },
  );
  return true;
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
