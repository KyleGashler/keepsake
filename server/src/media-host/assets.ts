import type { MediaStatus, MuxAsset, Prisma, TranscriptStatus } from "@prisma/client";
import type { JobQueue } from "../jobs/JobQueue.js";
import { prisma } from "../lib/prisma.js";
import type { AssetSnapshot, HostUpload, MediaHost } from "./MediaHost.js";

/**
 * The database side of a Mux clip: the `MuxAsset` row and the Media rows
 * linked to it.
 *
 * Four writers touch a row — init, finalize, webhooks and the `mux.sync`
 * job — in no guaranteed order, and webhooks can repeat. So every write is a
 * merge of facts Mux reported, done under a row lock, that never moves a
 * fact backwards (a `ready` asset can't become `preparing` again). `status`
 * is then computed from the facts, never set directly. Replaying any event
 * therefore changes nothing.
 *
 * The other half is linking. A clip can finish (and its captions too) before
 * or after `POST /memories` creates the Media row that points at it. Both
 * sides call `settleLinkedMedia` while holding the MuxAsset row lock, so
 * whichever happens second copies the facts onto the Media row and offers the
 * transcript to the memory.
 */

export const MUX_KEY_PREFIX = "mux:";

/** `mux:<uploadId>` — what init hands the client in place of a storage key. */
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

/** Mux's name for the audio-only static rendition. */
const AUDIO_RENDITION = "audio.m4a";

/** The facts `status` is computed from. */
type Facts = Pick<
  MuxAsset,
  "type" | "uploadStatus" | "assetId" | "assetStatus" | "playbackId" | "renditionStatus" | "syncGaveUpAt"
>;

/**
 * UPLOADING until Mux has the bytes, PROCESSING while it transcodes, READY
 * once it plays (audio: once its `audio.m4a` is done, or known not to be
 * coming), FAILED when Mux says so — or when polling gave up, until a later
 * fact says otherwise.
 */
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

/** Nothing left to wait for: playable or failed, and captions done either way. */
export function isSettled(row: Pick<MuxAsset, "status" | "captionStatus">) {
  return (row.status === "READY" || row.status === "FAILED") && row.captionStatus !== "PENDING";
}

/** A terminal Mux status wins over a `preparing` one, whatever order they arrive in. */
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
  >
>;

/** What an upload's state adds. An upload only ever moves on from `waiting`. */
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

/** What a full asset snapshot (API read or webhook body) adds. */
export function snapshotPatch(row: MuxAsset, snap: AssetSnapshot): Patch {
  const patch: Patch = {};
  if (!row.assetId) patch.assetId = snap.id;
  // An asset exists, so the upload delivered, whether or not that event came first.
  if (row.uploadStatus === "waiting") patch.uploadStatus = "asset_created";

  const assetStatus = mergeProgress(row.assetStatus, snap.status);
  if (assetStatus !== row.assetStatus) patch.assetStatus = assetStatus;

  Object.assign(patch, playbackFacts(row, snap), captionFacts(row, snap, assetStatus));

  if (assetStatus === "errored" && !row.error) {
    const messages = snap.errors?.messages?.filter(Boolean) ?? [];
    patch.error = messages.join("; ") || snap.errors?.type || "Mux couldn't process this file";
  }
  return patch;
}

/** Playback id, duration, dimensions, audio track and (audio only) the m4a rendition. */
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

/** The generated caption track to read, and what its state (or the asset's) says. */
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
    // A ready asset with no audio track: nothing was said, and nothing ever
    // will be. An empty transcript, settled.
    patch.captionStatus = "READY";
    patch.transcript = "";
  }
  return patch;
}

/** A caption track's state, from a `video.asset.track.*` webhook. */
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

/** The audio rendition's state, from a `video.asset.static_rendition.*` webhook. */
export function renditionPatch(row: MuxAsset, name: string | null | undefined, status: string): Patch {
  if (row.type !== "AUDIO" || name !== AUDIO_RENDITION) return {};
  const renditionStatus = mergeProgress(row.renditionStatus, status);
  return renditionStatus === row.renditionStatus ? {} : { renditionStatus };
}

/** Polling stopped with the asset unsettled: whatever is still pending fails. */
export function giveUpPatch(row: MuxAsset): Patch {
  const patch: Patch = { syncGaveUpAt: new Date() };
  if (row.captionStatus === "PENDING") patch.captionStatus = "FAILED";
  if (row.status !== "READY" && !row.error) patch.error = "Mux didn't finish processing this clip in time";
  return patch;
}

/**
 * Captions asked for again (the transcript retry): read the new track, and
 * stop counting the old give-up against the asset. The old transcript stays
 * until the new one arrives, so the memory merge knows what it replaces.
 */
export function captionRetryPatch(trackId: string | null): Patch {
  // No id back from Mux: forget the old (failed) track, and the next asset
  // read picks the generated track that isn't errored.
  return { captionTrackId: trackId ?? null, captionStatus: "PENDING", syncGaveUpAt: null };
}

/**
 * The Mux side of a transcript retry. Returns the caption track to read next.
 *
 * Mux refuses to generate captions in a language an existing generated track
 * already has — errored or not. So: a generated track that is ready (the text
 * exists; fetching it failed or polling gave up) or still preparing is simply
 * read again. Only when every generated track errored are those failed text
 * tracks removed and captions generated anew. The asset, its audio and its
 * video are never touched.
 */
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

/** The transcript text for one caption track, once fetched. Ignored if the track changed meanwhile (a retry). */
export function transcriptPatch(row: MuxAsset, trackId: string, text: string): Patch {
  if (row.captionTrackId !== trackId || row.captionStatus !== "PENDING") return {};
  return { transcript: text, captionStatus: "READY" };
}

export type AssetLookup = { id: string } | { uploadId?: string | null; assetId?: string | null };

/**
 * Lock one MuxAsset row, apply `mutate`'s patch, recompute `status`, and
 * bring every linked Media row up to date — one transaction. Returns the row
 * as it now stands, or null when no row matches (an event for an upload this
 * database never made: another environment, or a test event).
 */
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

/** `SELECT … FOR UPDATE` on one MuxAsset row, then read it whole. */
async function lockAsset(tx: Prisma.TransactionClient, lookup: AssetLookup): Promise<MuxAsset | null> {
  // By asset id or upload id: an asset event can arrive before the upload
  // event that told us the asset id, but it carries the upload id too.
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

/**
 * Lock several MuxAsset rows (in id order, so two callers can't deadlock).
 * `POST /memories` holds these while it creates the Media rows that link to
 * them, so a webhook can't settle the asset in between and miss the new rows.
 */
export async function lockAssets(tx: Prisma.TransactionClient, ids: string[]): Promise<MuxAsset[]> {
  if (ids.length === 0) return [];
  await tx.$queryRaw`SELECT id FROM "MuxAsset" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  return tx.muxAsset.findMany({ where: { id: { in: ids } } });
}

/** A linked Media row's status: it never says UPLOADING (a memory only links finalized uploads). */
function mediaStatusFor(asset: MuxAsset): MediaStatus {
  return asset.status === "READY" || asset.status === "FAILED" ? asset.status : "PROCESSING";
}

/**
 * Copy what an asset knows onto every live Media row linked to it, and offer
 * a newly arrived transcript to each row's memory. Idempotent: a row already
 * up to date is left alone. Call with the MuxAsset row locked.
 */
export async function settleLinkedMedia(tx: Prisma.TransactionClient, asset: MuxAsset) {
  const media = await tx.media.findMany({ where: { muxAssetId: asset.id, deletedAt: null } });
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
  }
}

const TRANSCRIBABLE_TYPES = ["AUDIO", "VIDEO"] as const;

/**
 * Rebuild the machine copy of the memory's transcript from its clips, in sort
 * order, if — and only if — no person has written it.
 *
 * `Memory.transcript` belongs to the family: they can type or edit it at any
 * time. It is only written when empty or still exactly what this function
 * would have written before the clip that just changed (`previousText` is
 * that clip's old transcript, null on its first). Any human edit makes it
 * differ, and from then on it is left alone.
 */
export async function offerToMemory(
  tx: Prisma.TransactionClient,
  memoryId: string,
  justFinished: string,
  previousText: string | null,
) {
  // Row lock: two clips of one memory finishing together must not each see
  // the other's half and both write.
  const [memory] = await tx.$queryRaw<{ transcript: string | null }[]>`
    SELECT transcript FROM "Memory" WHERE id = ${memoryId} FOR UPDATE`;
  if (!memory) return;

  const clips = await tx.media.findMany({
    where: {
      memoryId,
      deletedAt: null,
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
  // What would have been there before this clip changed: the same clips, with
  // this one's previous text (none on a first run; the old text on a re-run).
  const machineWrittenBefore = join(
    clips.map((c) => (c.id === justFinished ? { ...c, transcript: previousText } : c)),
  );
  if (current !== "" && current !== machineWrittenBefore) return; // a person's words

  const next = join(clips);
  if (next && next !== current) {
    await tx.memory.update({ where: { id: memoryId }, data: { transcript: next } });
  }
}

// ---------------------------------------------------------------------------
// Scheduling `mux.sync`. At most one queued job per asset: a new reason to
// look (finalize, a webhook, a retry) pulls the queued one forward instead of
// adding a second.
// ---------------------------------------------------------------------------

function queuedSync(muxAssetId: string): Prisma.JobWhereInput {
  return { type: "mux.sync", status: "QUEUED", payload: { path: ["muxAssetId"], equals: muxAssetId } };
}

/** Look at this asset now: run the queued sync job at once, or queue one. */
export async function kickSync(queue: JobQueue, muxAssetId: string, db: Prisma.TransactionClient = prisma) {
  const pulled = await db.job.updateMany({ where: queuedSync(muxAssetId), data: { runAt: new Date() } });
  if (pulled.count > 0) return;
  await queue.enqueue("mux.sync", { muxAssetId, startedAt: Date.now() }, { db });
}

/** From inside a sync run: look again after `delayMs`, unless something already queued a look. */
export async function continueSync(queue: JobQueue, muxAssetId: string, startedAt: number, delayMs: number) {
  if ((await prisma.job.count({ where: queuedSync(muxAssetId) })) > 0) return;
  await queue.enqueue("mux.sync", { muxAssetId, startedAt }, { runAt: new Date(Date.now() + delayMs) });
}
