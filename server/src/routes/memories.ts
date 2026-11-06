import { Router } from "express";
import { z } from "zod";
import { requireContributor } from "../auth/middleware.js";
import { jobQueue } from "../jobs/index.js";
import { kickRefresh } from "../jobs/memory-refresh.js";
import { prisma } from "../lib/prisma.js";
import { hueForSeed } from "../lib/placeholder.js";
import { linkPair, memoryDetail } from "../lib/memory-detail.js";
import { mediaInclude, memoryCardDtos } from "../lib/serialize.js";
import { memoryDownloads } from "../lib/downloads.js";
import { attachMedia, mediaInput } from "../lib/memory-media.js";
import { deleteAndPurge } from "../lib/purge.js";
import {
  captionRetryPatch,
  kickSync,
  lockAssets,
  requestCaptionsAgain,
  updateMuxAsset,
  holdMachineTranscript,
} from "../media-host/assets.js";
import { MediaHostError, mediaHost } from "../media-host/index.js";

export const memoriesRouter = Router();

const include = {
  media: mediaInclude,
  author: true,
  participants: { include: { person: true } },
  collections: { include: { collection: { include: { parent: { select: { name: true } } } } } },
} as const;

const listQuery = z.object({
  collectionId: z.string().optional(),
  personId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

memoriesRouter.get("/memories", async (req, res) => {
  const family = req.ctx.family;
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { collectionId, personId, limit, offset } = parsed.data;

  const where = {
    familyId: family.id,
    ...(collectionId ? { collections: { some: { collectionId } } } : {}),
    ...(personId ? { participants: { some: { personId } } } : {}),
  };

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit,
      skip: offset,
      include: { media: mediaInclude, participants: { include: { person: true } } },
    }),
    prisma.memory.count({ where }),
  ]);

  res.json({ memories: await memoryCardDtos(memories), total });
});

memoriesRouter.get("/memories/:id", async (req, res) => {
  // findFirst, not findUnique: an id from another family must read as absent,
  // not as forbidden — otherwise the 404/403 split confirms the id exists.
  const memory = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: req.ctx.family.id },
    include,
  });
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  res.json({ memory: await memoryDetail(req.ctx.family.id, req.ctx.user.id, memory) });
});

const newMemory = z.object({
  title: z.string().min(1).max(160),
  story: z.string().max(20_000).optional(),
  transcript: z.string().max(50_000).optional(),
  occurredAt: z.string().datetime().optional(),
  location: z.string().max(160).optional(),
  authorId: z.string().optional(),
  participantIds: z.array(z.string()).default([]),
  collectionIds: z.array(z.string()).default([]),
  media: z.array(mediaInput).default([]),
});

memoriesRouter.post("/memories", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = newMemory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;

  // Every id the client hands us is a chance to reach into another archive.
  // Confirm each one belongs to this family before it becomes a relation.
  const personIds = [...new Set([...input.participantIds, ...(input.authorId ? [input.authorId] : [])])];
  const [knownPeople, knownCollections] = await Promise.all([
    personIds.length
      ? prisma.person.findMany({
          where: { id: { in: personIds }, familyId: family.id },
          select: { id: true },
        })
      : [],
    input.collectionIds.length
      ? prisma.collection.findMany({
          where: { id: { in: input.collectionIds }, familyId: family.id },
          select: { id: true },
        })
      : [],
  ]);
  if (knownPeople.length !== personIds.length || knownCollections.length !== new Set(input.collectionIds).size) {
    return res.status(400).json({ error: "unknown_reference" });
  }

  const heroSeed = `memory-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const memory = await prisma.$transaction(async (tx) => {
    const created = await tx.memory.create({
      data: {
        familyId: family.id,
        title: input.title,
        story: input.story ?? null,
        transcript: input.transcript ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        // No date sent: the photos' EXIF may give one (A6, memory.refresh).
        occurredAtSource: input.occurredAt ? "HUMAN" : "DEFAULT",
        location: input.location ?? null,
        authorId: input.authorId ?? null,
        heroSeed,
        paletteHue: hueForSeed(heroSeed),
        brightness: 40 + (heroSeed.length % 40),
        participants: { create: input.participantIds.map((personId) => ({ personId })) },
        collections: { create: input.collectionIds.map((collectionId) => ({ collectionId })) },
      },
      select: { id: true },
    });
    await attachMedia(tx, family.id, created.id, input.media);
    return tx.memory.findUniqueOrThrow({ where: { id: created.id }, include });
  });

  const author = memory.author?.name ?? "Someone";
  await prisma.activityEvent.create({
    data: {
      familyId: family.id,
      actorId: memory.authorId,
      kind: "memory_added",
      message: `${author} added "${memory.title}".`,
    },
  });

  res.status(201).json({ memory: await memoryDetail(family.id, req.ctx.user.id, memory) });
});

const editMemory = z.object({
  title: z.string().min(1).max(160).optional(),
  story: z.string().max(20_000).nullable().optional(),
  transcript: z.string().max(50_000).nullable().optional(),
  location: z.string().max(160).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  /**
   * The full set of collections the memory is filed in, replacing the old
   * set — "add to another collection" sends old + new, "move" sends the new
   * one alone. Empty unfiles it.
   */
  collectionIds: z.array(z.string()).max(100).optional(),
});

/** AI assists, families decide — every narrative stays editable. */
memoriesRouter.patch("/memories/:id", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = editMemory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { occurredAt, collectionIds, ...rest } = parsed.data;

  const existing = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: family.id },
    select: { id: true, story: true },
  });
  if (!existing) return res.status(404).json({ error: "Memory not found" });

  const wanted = collectionIds ? [...new Set(collectionIds)] : null;
  if (wanted?.length) {
    const known = await prisma.collection.count({ where: { id: { in: wanted }, familyId: family.id } });
    if (known !== wanted.length) return res.status(400).json({ error: "unknown_reference" });
  }

  const memory = await prisma.$transaction(async (tx) => {
    if (wanted) {
      await tx.memoryCollection.deleteMany({ where: { memoryId: existing.id, collectionId: { notIn: wanted } } });
      await tx.memoryCollection.createMany({
        data: wanted.map((collectionId) => ({ memoryId: existing.id, collectionId })),
        skipDuplicates: true,
      });
    }
    return tx.memory.update({
      where: { id: existing.id },
      // A date someone sets is theirs: no job moves it after this. A story
      // someone writes or edits is theirs too, and stops reading as an AI draft.
      data: {
        ...rest,
        ...(occurredAt ? { occurredAt: new Date(occurredAt), occurredAtSource: "HUMAN" as const } : {}),
        ...(rest.story !== undefined && rest.story !== existing.story ? { storySource: "HUMAN" as const } : {}),
      },
      include,
    });
  });

  res.json({ memory: await memoryDetail(family.id, req.ctx.user.id, memory) });
});

/**
 * Delete a memory for good — there is no trash. Its rows go now (media,
 * participants, collection links, favourites and links cascade); its files
 * (photo originals and derivatives, Mux assets nothing else shows) are
 * purged by a `media.purge` job, so this answers without waiting on S3 or Mux.
 */
memoriesRouter.delete("/memories/:id", requireContributor, async (req, res) => {
  const familyId = req.ctx.family.id;
  const deleted = await prisma.$transaction(async (tx) => {
    const memory = await tx.memory.findFirst({ where: { id: req.params.id, familyId }, select: { id: true } });
    if (!memory) return false;
    await deleteAndPurge(tx, jobQueue(), { familyId, reason: "memory", media: { memoryId: memory.id } }, () =>
      tx.memory.delete({ where: { id: memory.id } }),
    );
    return true;
  });
  if (!deleted) return res.status(404).json({ error: "Memory not found" });
  req.log.info({ familyId, memoryId: req.params.id, by: req.ctx.user.id }, "memory deleted");
  res.status(204).end();
});

const addMedia = z.object({
  media: z
    .array(mediaInput)
    .min(1)
    .max(50)
    .refine((all) => all.every((m) => m.storageKey), { message: "each item needs a storageKey from /api/media/finalize" }),
});

memoriesRouter.post("/memories/:id/media", requireContributor, async (req, res) => {
  const familyId = req.ctx.family.id;
  const parsed = addMedia.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const memory = await findMemory(familyId, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  await prisma.$transaction((tx) => attachMedia(tx, familyId, memory.id, parsed.data.media));

  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId }, include });
  res.status(201).json({ memory: await memoryDetail(familyId, req.ctx.user.id, updated) });
});

/**
 * Take one photo, video or recording off a memory, for good: the row goes
 * now and its files are purged by `media.purge`, as for a whole memory. If
 * the memory's transcript is still the machine's copy of its clips, it's
 * rebuilt without this one; a person's words are left alone. Answers with
 * the memory as it now stands.
 */
memoriesRouter.delete("/memories/:id/media/:mediaId", requireContributor, async (req, res) => {
  const familyId = req.ctx.family.id;
  const memory = await findMemory(familyId, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  const removed = await prisma.$transaction(async (tx) => {
    const media = await tx.media.findFirst({
      where: { id: req.params.mediaId, memoryId: memory.id },
      select: { id: true },
    });
    if (!media) return false;
    await deleteAndPurge(tx, jobQueue(), { familyId, reason: "media", media: { id: media.id } }, async () => {
      const rewriteTranscript = await holdMachineTranscript(tx, memory.id);
      await tx.media.delete({ where: { id: media.id } });
      await rewriteTranscript();
    });
    // It may have been the hero, or the photo that dated the memory.
    await kickRefresh(jobQueue(), familyId, memory.id, tx);
    return true;
  });
  if (!removed) return res.status(404).json({ error: "Media not found" });

  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId }, include });
  res.json({ memory: await memoryDetail(familyId, req.ctx.user.id, updated) });
});

const mediaOrder = z.object({ mediaIds: z.array(z.string().min(1)).min(1).max(500) });

/**
 * Put a memory's photos, videos and recordings in a new order. `mediaIds` is
 * every one of the memory's media ids, once each, in the order wanted; the
 * first photo or video becomes the memory's hero. Anything else (a missing
 * id, an extra one, a repeat) is `400 order_mismatch` — the client's list
 * is stale, so it should reload rather than guess.
 */
memoriesRouter.put("/memories/:id/media/order", requireContributor, async (req, res) => {
  const familyId = req.ctx.family.id;
  const parsed = mediaOrder.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const memory = await findMemory(familyId, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  const wanted = parsed.data.mediaIds;
  const ok = await prisma.$transaction(async (tx) => {
    const current = await tx.media.findMany({ where: { memoryId: memory.id }, select: { id: true, muxAssetId: true } });
    // Same lock order as the Mux writers (asset rows, then the memory), which
    // also keeps two reorders, or a reorder and a removal, from interleaving.
    await lockAssets(tx, [...new Set(current.flatMap((m) => (m.muxAssetId ? [m.muxAssetId] : [])))]);
    const rewriteTranscript = await holdMachineTranscript(tx, memory.id);
    const ids = new Set(current.map((m) => m.id));
    if (new Set(wanted).size !== wanted.length || wanted.length !== ids.size || wanted.some((id) => !ids.has(id))) {
      return false;
    }
    for (const [sortOrder, id] of wanted.entries()) {
      await tx.media.update({ where: { id }, data: { sortOrder } });
    }
    // The machine transcript follows the clips' order.
    await rewriteTranscript();
    // A new first photo is a new hero: Mosaic's palette follows it.
    await kickRefresh(jobQueue(), familyId, memory.id, tx);
    return true;
  });
  if (!ok) {
    return res
      .status(400)
      .json({ error: "order_mismatch", message: "mediaIds must list every media item of this memory once" });
  }

  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId }, include });
  res.json({ memory: await memoryDetail(familyId, req.ctx.user.id, updated) });
});

const downloadsBody = z.object({ timeZone: z.string().max(64).optional() }).optional();

/**
 * Every file of a memory, ready to save (A17; lib/downloads.ts): `{ files:
 * [{ mediaId, type, filename, status, url?, expiresAt? }], unavailable }` in
 * the memory's order. Any member may download what they can read, a VIEWER
 * too. A POST because the first call for a video asks Mux to prepare its
 * master; calling again is how the client polls, and never asks twice.
 */
memoriesRouter.post("/memories/:id/downloads", async (req, res) => {
  const parsed = downloadsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await memoryDownloads(req.ctx.family.id, req.params.id, {
    timeZone: parsed.data?.timeZone,
    log: req.log,
  });
  if (!result) return res.status(404).json({ error: "Memory not found" });
  res.json(result);
});

/** A memory of the caller's family, or null. */
function findMemory(familyId: string, id: string) {
  return prisma.memory.findFirst({ where: { id, familyId }, select: { id: true } });
}

/**
 * Favourites belong to the signed-in user, not the family — so a VIEWER, who
 * can't change the archive, can still keep their own.
 */
memoriesRouter.put("/memories/:id/favorite", async (req, res) => {
  const memory = await findMemory(req.ctx.family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  await prisma.memoryFavorite.upsert({
    where: { userId_memoryId: { userId: req.ctx.user.id, memoryId: memory.id } },
    create: { userId: req.ctx.user.id, memoryId: memory.id },
    update: {},
  });
  res.json({ isFavorite: true });
});

memoriesRouter.delete("/memories/:id/favorite", async (req, res) => {
  const memory = await findMemory(req.ctx.family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  await prisma.memoryFavorite.deleteMany({ where: { userId: req.ctx.user.id, memoryId: memory.id } });
  res.json({ isFavorite: false });
});

const newLink = z.object({ linkedId: z.string().min(1) });

/** Link a related memory by hand. Undirected; linking twice is a no-op. */
memoriesRouter.post("/memories/:id/links", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = newLink.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.linkedId === req.params.id) {
    return res.status(400).json({ error: "A memory can't be linked to itself" });
  }

  const [memory, other] = await Promise.all([
    findMemory(family.id, req.params.id),
    findMemory(family.id, parsed.data.linkedId),
  ]);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  if (!other) return res.status(400).json({ error: "unknown_reference" });

  await prisma.memoryLink.createMany({ data: [linkPair(memory.id, other.id)], skipDuplicates: true });
  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId: family.id }, include });
  res.status(201).json({ memory: await memoryDetail(family.id, req.ctx.user.id, updated) });
});

memoriesRouter.delete("/memories/:id/links/:linkedId", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const memory = await findMemory(family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  // Both ends are this family's: `memory` was checked above, and a link is
  // only ever written between two memories of one family.
  await prisma.memoryLink.deleteMany({ where: linkPair(memory.id, req.params.linkedId) });
  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId: family.id }, include });
  res.json({ memory: await memoryDetail(family.id, req.ctx.user.id, updated) });
});

/**
 * Transcribe one clip again — the retry behind a FAILED transcript. Asks Mux
 * to generate captions again from the asset's audio track; `mux.sync` fetches
 * the new text when it's ready. The memory's own transcript is only replaced
 * if no person has written it (media-host/assets.ts#offerToMemory).
 *
 * 202 with the memory when queued (or already in progress). 409 when there's
 * nothing to retry: not a Mux clip, not playable, no sound, or already
 * transcribed.
 */
memoriesRouter.post("/memories/:id/media/:mediaId/transcribe", requireContributor, async (req, res) => {
  const familyId = req.ctx.family.id;
  const memory = await findMemory(familyId, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  const media = await prisma.media.findFirst({
    where: { id: req.params.mediaId, memoryId: memory.id },
    include: { muxAsset: true },
  });
  if (!media) return res.status(404).json({ error: "Media not found" });
  const asset = media.muxAsset;
  if (!asset || asset.familyId !== familyId) {
    return res
      .status(409)
      .json({ error: "Only uploaded audio and video can be transcribed", code: "not_transcribable" });
  }

  const respond = async () => {
    const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId }, include });
    res.status(202).json({ memory: await memoryDetail(familyId, req.ctx.user.id, updated) });
  };

  if (asset.captionStatus === "PENDING") {
    // Already on its way; make sure something is looking.
    await kickSync(jobQueue(), asset.id);
    return respond();
  }
  if (asset.captionStatus === "READY") {
    return res.status(409).json({ error: "This clip is already transcribed", code: "already_transcribed" });
  }
  if (asset.status !== "READY" || !asset.assetId) {
    return res
      .status(409)
      .json({ error: "This clip can't be played, so it can't be transcribed", code: "not_ready" });
  }
  if (!asset.audioTrackId) {
    return res.status(409).json({ error: "This clip has no sound to transcribe", code: "not_transcribable" });
  }

  const host = mediaHost();
  if (!host) {
    return res.status(503).json({ error: "Transcription isn't available on this server yet", code: "av_unavailable" });
  }
  let trackId: string | null;
  try {
    trackId = await requestCaptionsAgain(host, asset.assetId, asset.audioTrackId);
  } catch (err) {
    if (!(err instanceof MediaHostError)) throw err;
    req.log.error({ err }, "Mux caption retry failed");
    return res
      .status(err.retryable ? 502 : 409)
      .json({ error: "The video service refused to transcribe this clip again", code: "retry_refused" });
  }

  await updateMuxAsset({ id: asset.id }, () => captionRetryPatch(trackId));
  await kickSync(jobQueue(), asset.id);
  return respond();
});

