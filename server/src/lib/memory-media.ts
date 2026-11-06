import type { MuxAsset, Prisma } from "@prisma/client";
import { z } from "zod";
import { jobQueue } from "../jobs/index.js";
import { enqueueDerive } from "../jobs/media-derive.js";
import { isMuxKey, lockAssets, settleLinkedMedia, uploadIdFromKey } from "../media-host/assets.js";
import { keyBelongsTo } from "./upload-keys.js";

export const mediaInput = z
  .object({
    type: z.enum(["PHOTO", "VIDEO", "AUDIO"]),
    url: z.string().min(1).optional(),
    storageKey: z.string().min(1).max(512).optional(),
    mimeType: z.string().max(120).optional(),
    bytes: z.number().int().positive().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
    checksum: z
      .string()
      .max(200)
      .regex(/^(crc64nvme|sha256|crc32c|crc32|sha1):[A-Za-z0-9+/]+={0,2}$/)
      .nullish(),
    caption: z.string().max(280).optional(),
    width: z.number().int().positive().default(1200),
    height: z.number().int().positive().default(900),
    durationS: z.number().int().positive().optional(),
  })
  .refine((m) => Boolean(m.url || m.storageKey), {
    message: "media needs either a storageKey (from /api/media/finalize) or a url",
  });

export type MediaInput = z.infer<typeof mediaInput>;

export class MediaInputError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string; code?: string },
  ) {
    super(body.error);
  }
}

export async function attachMedia(
  tx: Prisma.TransactionClient,
  familyId: string,
  memoryId: string,
  media: MediaInput[],
) {
  if (media.length === 0) return;

  const foreign = media.find((m) => m.storageKey && !isMuxKey(m.storageKey) && !keyBelongsTo(m.storageKey, familyId));
  if (foreign) throw new MediaInputError(403, { error: "Storage key does not belong to this family" });
  if (media.some((m) => m.type !== "PHOTO" && m.storageKey && !isMuxKey(m.storageKey))) {
    throw new MediaInputError(400, {
      error: "Video and audio must be uploaded through /api/media/init",
      code: "av_requires_mux",
    });
  }

  const uploadIds = [
    ...new Set(media.flatMap((m) => (m.storageKey && isMuxKey(m.storageKey) ? [uploadIdFromKey(m.storageKey)] : []))),
  ];
  const found = uploadIds.length
    ? await tx.muxAsset.findMany({ where: { uploadId: { in: uploadIds }, familyId }, select: { id: true } })
    : [];
  const locked = await lockAssets(
    tx,
    found.map((a) => a.id),
  );
  // Lock order matches the Mux writers (assets, then memory), or they deadlock.
  const [held] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Memory" WHERE id = ${memoryId} AND "familyId" = ${familyId} FOR UPDATE`;
  if (!held) throw new MediaInputError(404, { error: "Memory not found" });

  const byUpload = new Map(locked.map((a) => [a.uploadId, a]));
  const assetFor = (m: MediaInput): MuxAsset | null =>
    m.storageKey && isMuxKey(m.storageKey) ? (byUpload.get(uploadIdFromKey(m.storageKey)) ?? null) : null;
  for (const m of media) {
    if (!m.storageKey || !isMuxKey(m.storageKey)) continue;
    const asset = assetFor(m);
    if (!asset) throw new MediaInputError(403, { error: "Storage key does not belong to this family" });
    if (asset.type !== m.type) {
      throw new MediaInputError(400, { error: `That upload is ${asset.type}, not ${m.type}`, code: "type_mismatch" });
    }
    if (asset.status === "UPLOADING") {
      throw new MediaInputError(409, {
        error: "Finalize the upload before attaching it",
        code: "upload_not_finalized",
      });
    }
  }

  const last = await tx.media.aggregate({ where: { memoryId }, _max: { sortOrder: true } });
  const start = (last._max.sortOrder ?? -1) + 1;

  const created = await tx.media.createManyAndReturn({
    data: media.map((m, i) => ({ memoryId, ...mediaRow(m, assetFor(m), start + i) })),
  });
  for (const asset of locked) await settleLinkedMedia(tx, asset);
  await enqueueDerive(jobQueue(), tx, familyId, created);
}

function mediaRow(m: MediaInput, asset: MuxAsset | null, sortOrder: number) {
  const common = {
    type: m.type,
    caption: m.caption ?? null,
    width: m.width,
    height: m.height,
    durationS: m.durationS ?? null,
    sortOrder,
  };
  if (asset) {
    return {
      ...common,
      url: "",
      muxAssetId: asset.id,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      status: "PROCESSING" as const,
      transcriptStatus: "PENDING" as const,
    };
  }
  return {
    ...common,
    url: m.storageKey ? "" : (m.url ?? ""),
    storageKey: m.storageKey ?? null,
    mimeType: m.mimeType ?? null,
    bytes: m.bytes ?? null,
    sha256: m.sha256 ?? null,
    checksum: m.checksum ?? null,
    status: "READY" as const,
  };
}
