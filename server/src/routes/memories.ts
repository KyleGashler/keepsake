import type { TranscriptStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { jobQueue } from "../jobs/index.js";
import { TRANSCRIBABLE_TYPES, enqueueTranscriptions, tooLongToTranscribe } from "../jobs/transcribe.js";
import { prisma } from "../lib/prisma.js";
import { hueForSeed } from "../lib/placeholder.js";
import { linkPair, memoryDetail } from "../lib/memory-detail.js";
import { memoryCardDtos } from "../lib/serialize.js";
import { keyBelongsTo } from "../lib/upload-keys.js";

/** An uploaded clip with sound in it — the only media the transcriber is given. */
function isTranscribable(m: { type: string; storageKey?: string | null }) {
  return TRANSCRIBABLE_TYPES.some((t) => t === m.type) && Boolean(m.storageKey);
}

/**
 * Photos and placeholder clips have nothing to transcribe: null. A video
 * known to be too long is SKIPPED, and gets no job.
 */
function initialTranscriptStatus(m: {
  type: string;
  storageKey?: string | null;
  durationS?: number | null;
}): TranscriptStatus | null {
  if (!isTranscribable(m)) return null;
  return tooLongToTranscribe(m) ? "SKIPPED" : "PENDING";
}

export const memoriesRouter = Router();

const include = {
  media: { orderBy: { sortOrder: "asc" } },
  author: true,
  participants: { include: { person: true } },
  collections: { include: { collection: true } },
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
    deletedAt: null,
    ...(collectionId ? { collections: { some: { collectionId } } } : {}),
    ...(personId ? { participants: { some: { personId } } } : {}),
  };

  const [memories, total] = await Promise.all([
    prisma.memory.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: limit,
      skip: offset,
      include: { media: true, participants: { include: { person: true } } },
    }),
    prisma.memory.count({ where }),
  ]);

  res.json({ memories: await memoryCardDtos(memories), total });
});

memoriesRouter.get("/memories/:id", async (req, res) => {
  // findFirst, not findUnique: an id from another family must read as absent,
  // not as forbidden — otherwise the 404/403 split confirms the id exists.
  const memory = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: req.ctx.family.id, deletedAt: null },
    include,
  });
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  res.json({ memory: await memoryDetail(req.ctx.family.id, req.ctx.user.id, memory) });
});

/**
 * A memory's media, as the client reports it.
 *
 * `storageKey` is the A5 path: the client has already run init → PUT →
 * finalize, and passes back exactly what finalize returned. `url` is the older
 * path, kept for the generated placeholders the seed writes and for anything
 * still pointing at `/media/uploads/*`. One or the other, never neither.
 */
const mediaInput = z
  .object({
    type: z.enum(["PHOTO", "VIDEO", "AUDIO"]),
    url: z.string().min(1).optional(),
    storageKey: z.string().min(1).max(512).optional(),
    mimeType: z.string().max(120).optional(),
    bytes: z.number().int().positive().optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
    // Storage's own digest of the object (`<algorithm>:<base64>`), exactly as
    // finalize returned it. One of this and sha256 is set for an upload.
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

memoriesRouter.post("/memories", async (req, res) => {
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

  // A storage key carries its owning family in its prefix; refuse to attach
  // another family's object to this family's memory.
  const foreign = input.media.find((m) => m.storageKey && !keyBelongsTo(m.storageKey, family.id));
  if (foreign) return res.status(403).json({ error: "Storage key does not belong to this family" });

  const heroSeed = `memory-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  // The memory and its transcription jobs commit together: a clip marked
  // PENDING always has a job that will settle it.
  const memory = await prisma.$transaction(async (tx) => {
    const created = await tx.memory.create({
      data: {
        familyId: family.id,
        title: input.title,
        story: input.story ?? null,
        transcript: input.transcript ?? null,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        location: input.location ?? null,
        authorId: input.authorId ?? null,
        heroSeed,
        paletteHue: hueForSeed(heroSeed),
        brightness: 40 + (heroSeed.length % 40),
        media: {
          create: input.media.map((m, i) => ({
            type: m.type,
            // Uploads have no stored URL: it's signed per response from the
            // storage key, because a presigned URL expires and this column
            // doesn't. See lib/serialize.ts#mediaReadUrl.
            url: m.storageKey ? "" : (m.url ?? ""),
            storageKey: m.storageKey ?? null,
            mimeType: m.mimeType ?? null,
            bytes: m.bytes ?? null,
            sha256: m.sha256 ?? null,
            checksum: m.checksum ?? null,
            status: "READY" as const,
            caption: m.caption ?? null,
            width: m.width,
            height: m.height,
            durationS: m.durationS ?? null,
            transcriptStatus: initialTranscriptStatus(m),
            sortOrder: i,
          })),
        },
        participants: { create: input.participantIds.map((personId) => ({ personId })) },
        collections: { create: input.collectionIds.map((collectionId) => ({ collectionId })) },
      },
      include,
    });
    const clips = created.media.filter((m) => m.transcriptStatus === "PENDING").map((m) => m.id);
    await enqueueTranscriptions(jobQueue(), clips, tx);
    return created;
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
memoriesRouter.patch("/memories/:id", async (req, res) => {
  const family = req.ctx.family;
  const parsed = editMemory.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { occurredAt, collectionIds, ...rest } = parsed.data;

  const existing = await prisma.memory.findFirst({
    where: { id: req.params.id, familyId: family.id, deletedAt: null },
    select: { id: true },
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
      data: { ...rest, ...(occurredAt ? { occurredAt: new Date(occurredAt) } : {}) },
      include,
    });
  });

  res.json({ memory: await memoryDetail(family.id, req.ctx.user.id, memory) });
});

/**
 * Soft delete: the memory disappears from every list, count and related list,
 * and its media and originals stay exactly where they are.
 */
memoriesRouter.delete("/memories/:id", async (req, res) => {
  const result = await prisma.memory.updateMany({
    where: { id: req.params.id, familyId: req.ctx.family.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) return res.status(404).json({ error: "Memory not found" });
  res.status(204).end();
});

/** A live memory of the caller's family, or null. */
function findLiveMemory(familyId: string, id: string) {
  return prisma.memory.findFirst({ where: { id, familyId, deletedAt: null }, select: { id: true } });
}

/** Favourites belong to the signed-in user, not the family. */
memoriesRouter.put("/memories/:id/favorite", async (req, res) => {
  const memory = await findLiveMemory(req.ctx.family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  await prisma.memoryFavorite.upsert({
    where: { userId_memoryId: { userId: req.ctx.user.id, memoryId: memory.id } },
    create: { userId: req.ctx.user.id, memoryId: memory.id },
    update: {},
  });
  res.json({ isFavorite: true });
});

memoriesRouter.delete("/memories/:id/favorite", async (req, res) => {
  const memory = await findLiveMemory(req.ctx.family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  await prisma.memoryFavorite.deleteMany({ where: { userId: req.ctx.user.id, memoryId: memory.id } });
  res.json({ isFavorite: false });
});

const newLink = z.object({ linkedId: z.string().min(1) });

/** Link a related memory by hand. Undirected; linking twice is a no-op. */
memoriesRouter.post("/memories/:id/links", async (req, res) => {
  const family = req.ctx.family;
  const parsed = newLink.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.linkedId === req.params.id) {
    return res.status(400).json({ error: "A memory can't be linked to itself" });
  }

  const [memory, other] = await Promise.all([
    findLiveMemory(family.id, req.params.id),
    findLiveMemory(family.id, parsed.data.linkedId),
  ]);
  if (!memory) return res.status(404).json({ error: "Memory not found" });
  if (!other) return res.status(400).json({ error: "unknown_reference" });

  await prisma.memoryLink.createMany({ data: [linkPair(memory.id, other.id)], skipDuplicates: true });
  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId: family.id }, include });
  res.status(201).json({ memory: await memoryDetail(family.id, req.ctx.user.id, updated) });
});

memoriesRouter.delete("/memories/:id/links/:linkedId", async (req, res) => {
  const family = req.ctx.family;
  const memory = await findLiveMemory(family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  // Both ends are this family's: `memory` was checked above, and a link is
  // only ever written between two memories of one family.
  await prisma.memoryLink.deleteMany({ where: linkPair(memory.id, req.params.linkedId) });
  const updated = await prisma.memory.findFirstOrThrow({ where: { id: memory.id, familyId: family.id }, include });
  res.json({ memory: await memoryDetail(family.id, req.ctx.user.id, updated) });
});

/**
 * Transcribe one clip again — the retry behind a FAILED clip, and a way to
 * re-run a READY one. The memory's own transcript is only replaced if no
 * person has written it (see jobs/transcribe.ts).
 */
memoriesRouter.post("/memories/:id/media/:mediaId/transcribe", async (req, res) => {
  const memory = await findLiveMemory(req.ctx.family.id, req.params.id);
  if (!memory) return res.status(404).json({ error: "Memory not found" });

  const media = await prisma.media.findFirst({
    where: { id: req.params.mediaId, memoryId: memory.id, deletedAt: null },
  });
  if (!media) return res.status(404).json({ error: "Media not found" });
  if (!isTranscribable(media)) {
    return res
      .status(409)
      .json({ error: "Only uploaded audio and video can be transcribed", code: "not_transcribable" });
  }
  // SKIPPED clips are over the limit by definition. This checks the length
  // rather than the status, so raising TRANSCRIBE_MAX_VIDEO_SECONDS lets a
  // clip that now fits be queued, and a long video that was transcribed
  // before its length was known can't be re-run at full cost.
  if (tooLongToTranscribe(media)) {
    return res.status(409).json({
      error: "Videos this long aren't transcribed yet",
      code: "too_long_to_transcribe",
    });
  }

  await prisma.$transaction(async (tx) => {
    // A clip already queued or running needs no second job; asking again is a no-op.
    const active = await tx.job.findFirst({
      where: {
        type: "ai.transcribe",
        status: { in: ["QUEUED", "RUNNING"] },
        payload: { path: ["mediaId"], equals: media.id },
      },
      select: { id: true },
    });
    await tx.media.update({ where: { id: media.id }, data: { transcriptStatus: "PENDING" } });
    if (!active) await enqueueTranscriptions(jobQueue(), [media.id], tx);
  });

  const updated = await prisma.memory.findFirstOrThrow({
    where: { id: memory.id, familyId: req.ctx.family.id },
    include,
  });
  res.status(202).json({ memory: await memoryDetail(req.ctx.family.id, req.ctx.user.id, updated) });
});
