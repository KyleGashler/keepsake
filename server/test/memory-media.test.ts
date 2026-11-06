import crypto from "node:crypto";
import type { MediaType, MediaStatus, TranscriptStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachMedia, MediaInputError, type MediaInput } from "../src/lib/memory-media.js";
import { prisma } from "../src/lib/prisma.js";
import { muxKey } from "../src/media-host/assets.js";
import { originalKey } from "../src/storage/index.js";

let family = "";
let memory = "";

beforeEach(async () => {
  await prisma.job.deleteMany();
  const created = await prisma.family.create({ data: { name: "Test family" } });
  family = created.id;
  memory = (
    await prisma.memory.create({
      data: { familyId: family, title: "Summer", occurredAt: new Date("2026-08-18T12:00:00Z"), heroSeed: "s" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const attach = (media: MediaInput[], familyId = family) =>
  prisma.$transaction((tx) => attachMedia(tx, familyId, memory, media));

function photo(familyId = family): MediaInput {
  return {
    type: "PHOTO",
    storageKey: originalKey(familyId, crypto.randomUUID(), ".jpg"),
    mimeType: "image/jpeg",
    bytes: 1000,
    width: 1200,
    height: 900,
  };
}

async function clip(
  type: MediaType,
  facts: { status?: MediaStatus; captionStatus?: TranscriptStatus; transcript?: string } = {},
): Promise<MediaInput> {
  const uploadId = crypto.randomUUID();
  await prisma.muxAsset.create({
    data: {
      familyId: family,
      uploadId,
      type,
      mimeType: type === "AUDIO" ? "audio/mp4" : "video/mp4",
      bytes: 5000,
      status: facts.status ?? "PROCESSING",
      captionStatus: facts.captionStatus ?? "PENDING",
      transcript: facts.transcript ?? null,
      durationS: 12,
    },
  });
  return { type, storageKey: muxKey(uploadId), width: 1200, height: 900 };
}

const mediaOf = () => prisma.media.findMany({ where: { memoryId: memory }, orderBy: { sortOrder: "asc" } });

describe("attachMedia", () => {
  it("puts new photos after the ones already there, and queues their renditions", async () => {
    await attach([photo()]);
    await attach([photo(), photo()]);

    const media = await mediaOf();
    expect(media.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
    const derives = await prisma.job.findMany({ where: { type: "media.derive" } });
    expect(derives).toHaveLength(3);
  });

  it("refuses another family's photo and adds nothing", async () => {
    const other = await prisma.family.create({ data: { name: "Other" } });
    const err = await attach([photo(), photo(other.id)]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MediaInputError);
    expect(err).toMatchObject({ status: 403 });
    expect(await mediaOf()).toHaveLength(0);
  });

  it("refuses a clip that hasn't finished uploading", async () => {
    const err = await attach([await clip("VIDEO", { status: "UPLOADING" })]).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, body: { code: "upload_not_finalized" } });
  });

  it("refuses a clip declared as the wrong type", async () => {
    const audio = await clip("AUDIO");
    const err = await attach([{ ...audio, type: "VIDEO" }]).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, body: { code: "type_mismatch" } });
  });

  it("adds a processing clip as PROCESSING, waiting on its transcript", async () => {
    await attach([await clip("VIDEO")]);
    const [video] = await mediaOf();
    expect(video).toMatchObject({ type: "VIDEO", status: "PROCESSING", transcriptStatus: "PENDING" });
  });

  it("a finished clip arrives ready, and the machine's transcript grows to include it", async () => {
    await attach([await clip("AUDIO", { status: "READY", captionStatus: "READY", transcript: "First words." })]);
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: memory } })).transcript).toBe("First words.");

    await attach([await clip("AUDIO", { status: "READY", captionStatus: "READY", transcript: "More words." })]);

    const media = await mediaOf();
    expect(media.map((m) => m.status)).toEqual(["READY", "READY"]);
    const after = await prisma.memory.findUniqueOrThrow({ where: { id: memory } });
    expect(after.transcript).toBe("First words.\n\nMore words.");
  });

  it("leaves a transcript a person wrote alone", async () => {
    await prisma.memory.update({ where: { id: memory }, data: { transcript: "In my own words." } });
    await attach([await clip("AUDIO", { status: "READY", captionStatus: "READY", transcript: "Machine words." })]);

    const after = await prisma.memory.findUniqueOrThrow({ where: { id: memory } });
    expect(after.transcript).toBe("In my own words.");
  });
});

describe("attachMedia on a memory that's gone", () => {
  it("answers 404 and adds nothing", async () => {
    await prisma.memory.delete({ where: { id: memory } });
    const err = await attach([photo()]).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404 });
    expect(await prisma.media.count({ where: { memoryId: memory } })).toBe(0);
  });

  it("answers 404 for another family's memory", async () => {
    const other = await prisma.family.create({ data: { name: "Other" } });
    const err = await attach([photo(other.id)], other.id).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404 });
  });
});
