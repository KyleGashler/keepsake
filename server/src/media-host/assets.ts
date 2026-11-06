import type { MediaStatus, MuxAsset, Prisma, TranscriptStatus } from "@prisma/client";
import type { JobQueue } from "../jobs/JobQueue.js";
import { kickRefresh } from "../jobs/memory-refresh.js";
import { jobQueue } from "../jobs/queue.js";
import { prisma } from "../lib/prisma.js";
import type { AssetSnapshot, HostUpload, MediaHost } from "./MediaHost.js";

// Init, finalize, webhooks and `mux.sync` write a row in any order and webhooks repeat, so every
// write merges Mux's facts under a row lock without moving any backwards, then recomputes `status`.

export const MUX_KEY_PREFIX = "mux:";

export function muxKey(uploadId: string) {
  return `${MUX_KEY_PREFIX}${uploadId}`;
}

export function isMuxKey(key: string) {
  return key.startsWith(MUX_KEY_PREFIX);
}

export function uploadIdFromKey(key: string) {
  return key.slice(MUX_KEY_PREFIX.length);
}

const FAILED_UPLOAD = new Set(["errored", "cancelled", "timed_out"]);

const AUDIO_RENDITION = "audio.m4a";

type Facts = Pick<
  MuxAsset,
  "type" | "uploadStatus" | "assetId" | "assetStatus" | "playbackId" | "renditionStatus" | "syncGaveUpAt"
>;

export function computeStatus(row: Facts): MediaStatus {
  if (row.assetStatus === "errored" || FAILED_UPLOAD.has(row.uploadStatus)) return "FAILED";
  const playable =
    row.assetStatus === "ready" &&
    Boolean(row.playbackId) &&
    (row.type === "VIDEO" || (row.renditionStatus !== null && row.renditionStatus !== "preparing"));
  if (playable) return "READY";
  if (row.syncGaveUpAt) return "FAILED";
  if (row.assetId || row.uploadStatus === "asset_created") return "PROCESSING";
  return "UPLOADING";
}

export function isSettled(row: Pick<MuxAsset, "status" | "captionStatus">) {
  return (row.status === "READY" || row.status === "FAILED") && row.captionStatus !== "PENDING";
}

function mergeProgress(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (current && current !== "preparing" && next === "preparing") return current;
  return next;
}

type Patch = Partial<
  Pick<
    MuxAsset,
    | "assetId"
    | "playbackId"
    | "uploadStatus"
    | "assetStatus"
    | "renditionStatus"
    | "durationS"
    | "width"
    | "height"
    | "audioTrackId"
    | "captionTrackId"
    | "captionStatus"
    | "transcript"
    | "error"
    | "syncGaveUpAt"
    | "masterStatus"
    | "masterUrl"
    | "masterExpiresAt"
    | "masterCheckedAt"
  >
>;

export function uploadPatch(row: MuxAsset, upload: Pick<HostUpload, "status" | "assetId" | "error">): Patch {
  const patch: Patch = {};
  if (row.uploadStatus === "waiting" && upload.status !== "waiting") patch.uploadStatus = upload.status;
  if (!row.assetId && upload.assetId) patch.assetId = upload.assetId;
  if (FAILED_UPLOAD.has(upload.status)) {
    patch.error = row.error ?? upload.error ?? `upload ${upload.status}`;
    if (row.captionStatus === "PENDING") patch.captionStatus = "FAILED";
  }
  return patch;
}

export function snapshotPatch(row: MuxAsset, snap: AssetSnapshot): Patch {
  const patch: Patch = {};
  if (!row.assetId) patch.assetId = snap.id;
  if (row.uploadStatus === "waiting") patch.uploadStatus = "asset_created";

  const assetStatus = mergeProgress(row.assetStatus, snap.status);
  if (assetStatus !== row.assetStatus) patch.assetStatus = assetStatus;

  Object.assign(patch, playbackFacts(row, snap), captionFacts(row, snap, assetStatus), masterPatch(row, snap.master));

  if (assetStatus === "errored" && !row.error) {
    const messages = snap.errors?.messages?.filter(Boolean) ?? [];
    patch.error = messages.join("; ") || snap.errors?.type || "Mux couldn't process this file";
  }
  return patch;
}

function playbackFacts(row: MuxAsset, snap: AssetSnapshot): Patch {
  const patch: Patch = {};
  const playback = snap.playback_ids?.find((p) => p.policy === "signed") ?? snap.playback_ids?.[0];
  if (playback && playback.id !== row.playbackId) patch.playbackId = playback.id;

  if (typeof snap.duration === "number" && snap.duration > 0) {
    const durationS = Math.max(1, Math.round(snap.duration));
    if (durationS !== row.durationS) patch.durationS = durationS;
  }

  const tracks = snap.tracks ?? [];
  const video = tracks.find((t) => t.type === "video");
  if (video?.max_width && video.max_height && (video.max_width !== row.width || video.max_height !== row.height)) {
    patch.width = video.max_width;
    patch.height = video.max_height;
  }
  const audio = primaryAudio(snap);
  if (audio?.id && audio.id !== row.audioTrackId) patch.audioTrackId = audio.id;

  if (row.type === "AUDIO") {
    const file = snap.static_renditions?.files?.find((f) => f.name === AUDIO_RENDITION);
    const renditionStatus = mergeProgress(row.renditionStatus, file?.status);
    if (renditionStatus !== row.renditionStatus) patch.renditionStatus = renditionStatus;
  }
  return patch;
}

function primaryAudio(snap: AssetSnapshot) {
  const tracks = snap.tracks ?? [];
  return tracks.find((t) => t.type === "audio" && t.primary) ?? tracks.find((t) => t.type === "audio");
}

function captionFacts(row: MuxAsset, snap: AssetSnapshot, assetStatus: string | null): Patch {
  const patch: Patch = {};
  const generated = (snap.tracks ?? []).filter((t) => t.type === "text" && t.text_source === "generated_vod" && t.id);
  const captionTrackId =
    row.captionTrackId ?? (generated.find((t) => t.status !== "errored") ?? generated[0])?.id ?? null;
  if (captionTrackId && captionTrackId !== row.captionTrackId) patch.captionTrackId = captionTrackId;
  if (row.captionStatus !== "PENDING") return patch;

  const captionTrack = generated.find((t) => t.id === captionTrackId);
  if (assetStatus === "errored") {
    patch.captionStatus = "FAILED";
  } else if (captionTrack?.status === "errored") {
    patch.captionStatus = "FAILED";
    patch.error = row.error ?? "Mux couldn't generate captions for this clip";
  } else if (assetStatus === "ready" && snap.tracks && !primaryAudio(snap)) {
    // No audio track: Mux will never generate captions, so settle on an empty transcript.
    patch.captionStatus = "READY";
    patch.transcript = "";
  }
  return patch;
}

export function captionTrackPatch(row: MuxAsset, track: { id: string; status: "ready" | "errored" }): Patch {
  const patch: Patch = {};
  const captionTrackId = row.captionTrackId ?? track.id;
  if (captionTrackId !== row.captionTrackId) patch.captionTrackId = captionTrackId;
  if (track.id === captionTrackId && track.status === "errored" && row.captionStatus === "PENDING") {
    patch.captionStatus = "FAILED";
    patch.error = row.error ?? "Mux couldn't generate captions for this clip";
  }
  return patch;
}

export function renditionPatch(row: MuxAsset, name: string | null | undefined, status: string): Patch {
  if (row.type !== "AUDIO" || name !== AUDIO_RENDITION) return {};
  const renditionStatus = mergeProgress(row.renditionStatus, status);
  return renditionStatus === row.renditionStatus ? {} : { renditionStatus };
}

// Most Mux events omit the master, so absence says nothing; only `master.deleted` clears it.
export function masterPatch(
  row: MuxAsset,
  master: { status?: string | null; url?: string | null } | null | undefined,
): Patch {
  if (!master?.status) return {};
  const patch: Patch = {};
  const masterStatus = mergeProgress(row.masterStatus, master.status);
  if (masterStatus !== row.masterStatus) patch.masterStatus = masterStatus;
  if (masterStatus === "ready" && master.url && master.url !== row.masterUrl) patch.masterUrl = master.url;
  return patch;
}

export function masterGonePatch(row: MuxAsset): Patch {
  if (row.masterStatus === null && row.masterUrl === null) return {};
  return { masterStatus: null, masterUrl: null };
}

export function masterRequestedPatch(
  row: MuxAsset,
  result: { requested: boolean; master: { status: string; url: string | null } | null },
  now: Date,
): Patch {
  const status = result.master?.status ?? (result.requested ? "preparing" : null);
  let expiresAt = new Date(now.getTime() + MASTER_ACCESS_MS);
  if (!result.requested) {
    const known = row.masterExpiresAt && row.masterExpiresAt > now ? row.masterExpiresAt : null;
    expiresAt = known ?? new Date(now.getTime() + ADOPTED_MASTER_MS);
  }
  return {
    masterStatus: status,
    masterUrl: status === "ready" ? (result.master?.url ?? null) : null,
    masterExpiresAt: status ? expiresAt : null,
    masterCheckedAt: now,
  };
}

// Mux keeps a temporary master for 24 hours from the request.
export const MASTER_ACCESS_MS = 24 * 60 * 60 * 1000;
// A master Mux already had when we asked is of unknown age, so trust it for an hour.
const ADOPTED_MASTER_MS = 60 * 60 * 1000;

export function giveUpPatch(row: MuxAsset): Patch {
  const patch: Patch = { syncGaveUpAt: new Date() };
  if (row.captionStatus === "PENDING") patch.captionStatus = "FAILED";
  if (row.status !== "READY" && !row.error) patch.error = "Mux didn't finish processing this clip in time";
  return patch;
}

// Keeps the old transcript until the new one lands: offerToMemory needs it to recognise the machine's copy.
export function captionRetryPatch(trackId: string | null): Patch {
  return { captionTrackId: trackId ?? null, captionStatus: "PENDING", syncGaveUpAt: null };
}

// Mux refuses to generate captions in a language an existing generated track already has, even an
// errored one: reuse a live track, else delete the errored ones before generating anew.
export async function requestCaptionsAgain(host: MediaHost, assetId: string, audioTrackId: string) {
  const snap = await host.getAsset(assetId);
  const generated = (snap.tracks ?? []).filter((t) => t.type === "text" && t.text_source === "generated_vod");
  const usable = generated.find((t) => t.status === "ready") ?? generated.find((t) => t.status === "preparing");
  if (usable?.id) return usable.id;
  for (const t of generated) {
    if (t.status === "errored" && t.id) await host.deleteFailedCaptionTrack(assetId, t.id);
  }
  const ids = await host.generateSubtitles(assetId, audioTrackId);
  return ids[0] ?? null;
}

export function transcriptPatch(row: MuxAsset, trackId: string, text: string): Patch {
  if (row.captionTrackId !== trackId || row.captionStatus !== "PENDING") return {};
  return { transcript: text, captionStatus: "READY" };
}

export type AssetLookup = { id: string } | { uploadId?: string | null; assetId?: string | null };

export async function updateMuxAsset(
  lookup: AssetLookup,
  mutate: (row: MuxAsset) => Patch,
): Promise<MuxAsset | null> {
  return prisma.$transaction(async (tx) => {
    const row = await lockAsset(tx, lookup);
    if (!row) return null;
    const patch = mutate(row);
    const status = computeStatus({ ...row, ...patch });
    const current: Record<string, unknown> = row;
    const changed =
      status !== row.status || Object.entries(patch).some(([k, v]) => !sameValue(v, current[k]));
    const updated = changed ? await tx.muxAsset.update({ where: { id: row.id }, data: { ...patch, status } }) : row;
    await settleLinkedMedia(tx, updated);
    return updated;
  });
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

async function lockAsset(tx: Prisma.TransactionClient, lookup: AssetLookup): Promise<MuxAsset | null> {
  // An asset event can arrive before the upload event that told us the asset id, but carries the upload id.
  const rows =
    "id" in lookup
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "MuxAsset" WHERE id = ${lookup.id} FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "MuxAsset"
          WHERE "assetId" = ${lookup.assetId ?? null} OR "uploadId" = ${lookup.uploadId ?? null}
          ORDER BY id
          LIMIT 1
          FOR UPDATE`;
  const id = rows[0]?.id;
  return id ? tx.muxAsset.findUnique({ where: { id } }) : null;
}

// Locks in id order so two callers can't deadlock. `POST /memories` holds these while linking Media
// rows, so a webhook can't settle the asset in between and miss them.
export async function lockAssets(tx: Prisma.TransactionClient, ids: string[]): Promise<MuxAsset[]> {
  if (ids.length === 0) return [];
  await tx.$queryRaw`SELECT id FROM "MuxAsset" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  return tx.muxAsset.findMany({ where: { id: { in: ids } } });
}

function mediaStatusFor(asset: MuxAsset): MediaStatus {
  return asset.status === "READY" || asset.status === "FAILED" ? asset.status : "PROCESSING";
}

// Call with the MuxAsset row locked. Runs from both the asset side and `POST /memories`, so
// whichever happens second does the linking.
export async function settleLinkedMedia(tx: Prisma.TransactionClient, asset: MuxAsset) {
  const media = await tx.media.findMany({ where: { muxAssetId: asset.id } });
  for (const m of media) {
    const data: Prisma.MediaUpdateInput = {};
    const status = mediaStatusFor(asset);
    if (m.status !== status) data.status = status;
    if (asset.durationS !== null && m.durationS !== asset.durationS) data.durationS = asset.durationS;
    if (asset.width !== null && asset.height !== null && (m.width !== asset.width || m.height !== asset.height)) {
      data.width = asset.width;
      data.height = asset.height;
    }

    let offer = false;
    const transcriptStatus: TranscriptStatus = asset.captionStatus;
    if (transcriptStatus === "READY") {
      const text = asset.transcript ?? "";
      if (m.transcriptStatus !== "READY" || m.transcript !== text) {
        data.transcript = text;
        data.transcriptStatus = "READY";
        offer = true;
      }
    } else if (m.transcriptStatus !== transcriptStatus) {
      data.transcriptStatus = transcriptStatus;
    }

    if (Object.keys(data).length === 0) continue;
    await tx.media.update({ where: { id: m.id }, data });
    if (offer) await offerToMemory(tx, m.memoryId, m.id, m.transcript);
    // `memory.refresh` derives the memory's hero from video posters.
    if (m.type === "VIDEO" && (status === "READY" || status === "FAILED") && data.status) {
      await kickRefresh(jobQueue(), asset.familyId, m.memoryId, tx);
    }
  }
}

const TRANSCRIBABLE_TYPES = ["AUDIO", "VIDEO"] as const;

// Never overwrite a person's words: only replace an empty transcript or the machine's previous copy.
export async function offerToMemory(
  tx: Prisma.TransactionClient,
  memoryId: string,
  justFinished: string,
  previousText: string | null,
) {
  // Row lock: two clips of one memory finishing together must not each see the other's half and both write.
  const [memory] = await tx.$queryRaw<{ transcript: string | null }[]>`
    SELECT transcript FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
  if (!memory) return;

  const clips = await tx.media.findMany({
    where: {
      memoryId,
      type: { in: [...TRANSCRIBABLE_TYPES] },
      transcriptStatus: "READY",
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, transcript: true },
  });
  const join = (rows: typeof clips) =>
    rows
      .map((c) => c.transcript?.trim() ?? "")
      .filter(Boolean)
      .join("\n\n");

  const current = memory.transcript?.trim() ?? "";
  const machineWrittenBefore = join(
    clips.map((c) => (c.id === justFinished ? { ...c, transcript: previousText } : c)),
  );
  if (current !== "" && current !== machineWrittenBefore) return;

  const next = join(clips);
  if (next && next !== current) {
    await tx.memory.update({ where: { id: memoryId }, data: { transcript: next } });
  }
}

export async function holdMachineTranscript(
  tx: Prisma.TransactionClient,
  memoryId: string,
): Promise<() => Promise<void>> {
  const [memory] = await tx.$queryRaw<{ transcript: string | null }[]>`
    SELECT transcript FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
  const current = memory?.transcript?.trim() ?? "";
  if (!memory || current === "" || current !== joinClipTranscripts(await readyClips(tx, memoryId))) {
    return async () => undefined;
  }
  return async () => {
    const next = joinClipTranscripts(await readyClips(tx, memoryId));
    if (next !== current) await tx.memory.update({ where: { id: memoryId }, data: { transcript: next || null } });
  };
}

function readyClips(tx: Prisma.TransactionClient, memoryId: string) {
  return tx.media.findMany({
    where: { memoryId, type: { in: [...TRANSCRIBABLE_TYPES] }, transcriptStatus: "READY" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { transcript: true },
  });
}

function joinClipTranscripts(clips: { transcript: string | null }[]) {
  return clips
    .map((c) => c.transcript?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function queuedSync(muxAssetId: string): Prisma.JobWhereInput {
  return { type: "mux.sync", status: "QUEUED", payload: { path: ["muxAssetId"], equals: muxAssetId } };
}

export async function kickSync(queue: JobQueue, muxAssetId: string, db: Prisma.TransactionClient = prisma) {
  const pulled = await db.job.updateMany({ where: queuedSync(muxAssetId), data: { runAt: new Date() } });
  if (pulled.count > 0) return;
  await queue.enqueue("mux.sync", { muxAssetId, startedAt: Date.now() }, { db });
}

export async function continueSync(queue: JobQueue, muxAssetId: string, startedAt: number, delayMs: number) {
  if ((await prisma.job.count({ where: queuedSync(muxAssetId) })) > 0) return;
  await queue.enqueue("mux.sync", { muxAssetId, startedAt }, { runAt: new Date(Date.now() + delayMs) });
}
