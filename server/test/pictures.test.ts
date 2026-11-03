import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { Pillar } from "@prisma/client";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageDeriveHandler } from "../src/jobs/image-derive.js";
import { jobPayloadSchemas, type JobContext, type JobType } from "../src/jobs/JobQueue.js";
import { mediaPurgeHandler } from "../src/jobs/media-purge.js";
import { logger } from "../src/lib/logger.js";
import { deleteIfUnused, pictureUrl, renditionsMade, setPicture, type PictureHolder } from "../src/lib/pictures.js";
import { prisma } from "../src/lib/prisma.js";
import { derivativeKey, localProvider, storage } from "../src/storage/index.js";

/**
 * The Picture module (lib/pictures.ts), through its interface, against a
 * scratch Postgres and local disk. Queued jobs are run by `runJobs`, which
 * hands each queued `media.purge` and `image.derive` payload straight to its
 * handler, as the worker would.
 */

const disk = () => {
  const provider = localProvider();
  if (!provider) throw new Error("tests expect STORAGE_PROVIDER=local");
  return provider;
};

let family = "";
let person = "";

beforeEach(async () => {
  await prisma.job.deleteMany();
  const created = await prisma.family.create({
    data: { name: "Test family", people: { create: { name: "Ada", role: "CHILD", avatarSeed: "ada" } } },
    include: { people: true },
  });
  family = created.id;
  person = created.people[0]?.id ?? "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A finalized upload: an Original of `ext`, really stored (unless `store` is false). */
async function upload(ext = ".jpg", store = true) {
  const key = `${family}/${crypto.randomUUID()}/original${ext}`;
  if (store) {
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 60, b: 40 } } })
      .jpeg()
      .toBuffer();
    await disk().writeObject(key, Readable.from([jpeg]));
  }
  return key;
}

const thumb = (key: string) => derivativeKey(key, "THUMB");
const display = (key: string) => derivativeKey(key, "DISPLAY");
const exists = async (key: string) => (await storage().head(key)) !== null;
const filesOf = async (key: string) => ({
  original: await exists(key),
  thumb: await exists(thumb(key)),
  display: await exists(display(key)),
});

/** The storage key a URL from `pictureUrl` serves (local read URLs carry it, signed). */
async function served(holder: PictureHolder, size: "THUMB" | "DISPLAY") {
  const url = await pictureUrl(holder, size);
  return url === null ? null : disk().verifyReadToken(url.replace("/media/o/", "")).key;
}

function context(type: JobType): JobContext {
  return { id: "test", type, attempt: 1, maxAttempts: 1, log: logger };
}

/** Run every queued job (and the jobs those queue) to completion. Returns the types run, in order. */
async function runJobs() {
  const ran: string[] = [];
  for (;;) {
    const jobs = await prisma.job.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (jobs.length === 0) return ran;
    for (const job of jobs) {
      await prisma.job.delete({ where: { id: job.id } });
      ran.push(job.type);
      switch (job.type) {
        case "media.purge":
          await mediaPurgeHandler().run(jobPayloadSchemas["media.purge"].parse(job.payload), context("media.purge"));
          break;
        case "image.derive":
          await imageDeriveHandler().run(jobPayloadSchemas["image.derive"].parse(job.payload), context("image.derive"));
          break;
        default:
          throw new Error(`unexpected job ${job.type}`);
      }
    }
  }
}

const personRow = () => prisma.person.findFirstOrThrow({ where: { id: person, familyId: family } });
const coverRow = (pillar: Pillar) => prisma.pillarCover.findUnique({ where: { familyId_pillar: { familyId: family, pillar } } });

/** A memory whose photo is `key`, with both Renditions written and recorded, as `media.derive` leaves it. */
async function memoryPhoto(key: string) {
  for (const at of [thumb(key), display(key)]) await storage().writeDerivative(at, Buffer.from("jpeg"), "image/jpeg");
  const memory = await prisma.memory.create({
    data: {
      familyId: family,
      title: "A day out",
      occurredAt: new Date(),
      heroSeed: "seed",
      media: {
        create: {
          type: "PHOTO",
          url: "",
          storageKey: key,
          derivatives: {
            create: [
              { kind: "THUMB", storageKey: thumb(key), mimeType: "image/jpeg" },
              { kind: "DISPLAY", storageKey: display(key), mimeType: "image/jpeg" },
            ],
          },
        },
      },
    },
    include: { media: { include: { derivatives: { select: { kind: true, storageKey: true } } } } },
  });
  const media = memory.media[0];
  if (!media) throw new Error("no media row");
  return media;
}

/** A promise the test settles by hand. */
function deferred() {
  const handle: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    handle.resolve = resolve;
  });
  return { promise, resolve: () => handle.resolve?.() };
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("pictureUrl", () => {
  it("serves a memory photo's Original until its Renditions exist, then each Rendition", async () => {
    const key = await upload();
    const bare = { storageKey: key, derivatives: [] };
    expect(await served(bare, "THUMB")).toBe(key);
    expect(await served(bare, "DISPLAY")).toBe(key);

    const thumbOnly = { storageKey: key, derivatives: [{ kind: "THUMB", storageKey: thumb(key) }] };
    expect(await served(thumbOnly, "THUMB")).toBe(thumb(key));
    expect(await served(thumbOnly, "DISPLAY")).toBe(key);

    const both = await memoryPhoto(key);
    expect(await served(both, "THUMB")).toBe(thumb(key));
    expect(await served(both, "DISPLAY")).toBe(display(key));
  });

  it("has no URL for a generated placeholder, a person without a photo", async () => {
    expect(await pictureUrl({ storageKey: null, derivatives: [] }, "DISPLAY")).toBeNull();
    expect(await pictureUrl({ photoKey: null, photoDerivedKey: null }, "THUMB")).toBeNull();
  });

  it("serves a profile photo's or cover's Renditions only for the very key they were made from", async () => {
    const key = await upload();
    const other = await upload();
    expect(await served({ photoKey: key, photoDerivedKey: null }, "THUMB")).toBe(key);
    expect(await served({ photoKey: key, photoDerivedKey: other }, "THUMB")).toBe(key);
    expect(await served({ photoKey: key, photoDerivedKey: key }, "THUMB")).toBe(thumb(key));
    expect(await served({ photoKey: key, photoDerivedKey: key }, "DISPLAY")).toBe(display(key));

    expect(await served({ storageKey: key, derivedKey: null }, "DISPLAY")).toBe(key);
    expect(await served({ storageKey: key, derivedKey: other }, "DISPLAY")).toBe(key);
    expect(await served({ storageKey: key, derivedKey: key }, "DISPLAY")).toBe(display(key));
    expect(await served({ storageKey: key, derivedKey: key }, "THUMB")).toBe(thumb(key));
  });
});

describe("setPicture: a profile photo", () => {
  it("sets, replaces and clears, deleting each Original it lets go of with its Renditions", async () => {
    const first = await upload();
    expect(await setPicture(family, { personId: person }, first)).toEqual({ ok: true });
    expect(await personRow()).toMatchObject({ photoKey: first, photoDerivedKey: null });
    expect(await served(await personRow(), "THUMB")).toBe(first);

    expect(await runJobs()).toEqual(["image.derive"]);
    expect(await personRow()).toMatchObject({ photoKey: first, photoDerivedKey: first });
    expect(await filesOf(first)).toEqual({ original: true, thumb: true, display: true });
    expect(await served(await personRow(), "THUMB")).toBe(thumb(first));
    expect(await served(await personRow(), "DISPLAY")).toBe(display(first));

    const second = await upload();
    expect(await setPicture(family, { personId: person }, second)).toEqual({ ok: true });
    expect(await personRow()).toMatchObject({ photoKey: second, photoDerivedKey: null });
    const ran = await runJobs();
    expect(ran).toHaveLength(2);
    expect(ran).toEqual(expect.arrayContaining(["image.derive", "media.purge"]));
    expect(await filesOf(first)).toEqual({ original: false, thumb: false, display: false });
    expect(await filesOf(second)).toEqual({ original: true, thumb: true, display: true });
    expect(await served(await personRow(), "DISPLAY")).toBe(display(second));

    expect(await setPicture(family, { personId: person }, null)).toEqual({ ok: true });
    expect(await personRow()).toMatchObject({ photoKey: null, photoDerivedKey: null });
    expect(await runJobs()).toEqual(["media.purge"]);
    expect(await filesOf(second)).toEqual({ original: false, thumb: false, display: false });
    expect(await pictureUrl(await personRow(), "THUMB")).toBeNull();
  });

  it("sending the current photo again queues its Renditions only while it has none", async () => {
    const key = await upload();
    await setPicture(family, { personId: person }, key);
    await prisma.job.deleteMany(); // as if that derive gave up
    expect(await setPicture(family, { personId: person }, key)).toEqual({ ok: true });
    expect(await runJobs()).toEqual(["image.derive"]);
    expect(await setPicture(family, { personId: person }, key)).toEqual({ ok: true });
    expect(await runJobs()).toEqual([]);
    expect(await filesOf(key)).toEqual({ original: true, thumb: true, display: true });
  });

  it("does nothing for a person who isn't in the family", async () => {
    const key = await upload();
    expect(await setPicture(family, { personId: "nobody" }, key)).toEqual({ ok: true });
    expect(await runJobs()).toEqual([]);
  });
});

describe("setPicture: a pillar cover", () => {
  it("sets, replaces and clears, deleting each Original it lets go of with its Renditions", async () => {
    const pillar = "FAMILY_LIFE";
    const first = await upload();
    expect(await setPicture(family, { pillar }, first)).toEqual({ ok: true });
    expect(await coverRow(pillar)).toMatchObject({ storageKey: first, derivedKey: null });
    expect(await runJobs()).toEqual(["image.derive"]);
    const cover = await coverRow(pillar);
    expect(cover).toMatchObject({ storageKey: first, derivedKey: first });
    expect(cover && (await served(cover, "DISPLAY"))).toBe(display(first));

    const second = await upload(".png");
    expect(await setPicture(family, { pillar }, second)).toEqual({ ok: true });
    expect(await coverRow(pillar)).toMatchObject({ storageKey: second, derivedKey: null });
    await runJobs();
    expect(await filesOf(first)).toEqual({ original: false, thumb: false, display: false });
    expect(await filesOf(second)).toEqual({ original: true, thumb: true, display: true });

    expect(await setPicture(family, { pillar }, null)).toEqual({ ok: true });
    expect(await coverRow(pillar)).toBeNull();
    await runJobs();
    expect(await filesOf(second)).toEqual({ original: false, thumb: false, display: false });

    // Clearing a pillar with no cover is a no-op.
    expect(await setPicture(family, { pillar }, null)).toEqual({ ok: true });
    expect(await runJobs()).toEqual([]);
  });
});

describe("a shared Original", () => {
  it("is kept, with its Renditions, while a memory photo still holds it", async () => {
    const key = await upload();
    const media = await memoryPhoto(key);
    await setPicture(family, { personId: person }, key);
    await runJobs();
    expect(await personRow()).toMatchObject({ photoKey: key, photoDerivedKey: key });

    await setPicture(family, { personId: person }, await upload());
    await runJobs();
    expect(await filesOf(key)).toEqual({ original: true, thumb: true, display: true });
    expect(await served(media, "THUMB")).toBe(thumb(key));
  });

  it("is kept while another person's photo or a cover holds it, and goes with the last Holder", async () => {
    const key = await upload();
    const sibling = await prisma.person.create({ data: { familyId: family, name: "Bo", role: "CHILD", avatarSeed: "bo" } });
    await setPicture(family, { personId: person }, key);
    await setPicture(family, { personId: sibling.id }, key);
    await setPicture(family, { pillar: "CHILD_PROFILES" }, key);
    await runJobs();
    expect(await filesOf(key)).toEqual({ original: true, thumb: true, display: true });

    await setPicture(family, { personId: person }, null);
    await setPicture(family, { pillar: "CHILD_PROFILES" }, null);
    await runJobs();
    expect(await filesOf(key)).toEqual({ original: true, thumb: true, display: true });

    await setPicture(family, { personId: sibling.id }, null);
    await runJobs();
    expect(await filesOf(key)).toEqual({ original: false, thumb: false, display: false });
  });
});

describe("setPicture problems", () => {
  it("refuses each bad key and changes nothing", async () => {
    const current = await upload();
    await setPicture(family, { personId: person }, current);
    await prisma.job.deleteMany();

    const cases: [string, string][] = [
      ["../etc/original.jpg", "malformed"],
      [`${family}//original.jpg`, "malformed"],
      [`someoneelse/${crypto.randomUUID()}/original.jpg`, "foreign"],
      [await upload(".mp4"), "not_an_image"],
      [thumb(current), "not_an_image"],
      [`${family}/${crypto.randomUUID()}/original.xyz`, "not_an_image"],
      [await upload(".jpg", false), "missing"],
    ];
    for (const [key, problem] of cases) {
      expect(await setPicture(family, { personId: person }, key), key).toEqual({ ok: false, problem });
      expect(await setPicture(family, { pillar: "ARRIVAL_STORIES" }, key), key).toEqual({ ok: false, problem });
    }
    expect(await personRow()).toMatchObject({ photoKey: current });
    expect(await coverRow("ARRIVAL_STORIES")).toBeNull();
    expect(await runJobs()).toEqual([]);
    expect(await exists(current)).toBe(true);
  });
});

describe("renditionsMade", () => {
  it("marks every Holder of the key", async () => {
    const key = await upload();
    await setPicture(family, { personId: person }, key);
    await setPicture(family, { pillar: "FAMILY_LIFE" }, key);
    expect(await renditionsMade(family, key, [thumb(key), display(key)])).toBe(2);
    expect(await personRow()).toMatchObject({ photoDerivedKey: key });
    expect(await coverRow("FAMILY_LIFE")).toMatchObject({ derivedKey: key });
  });

  it("deletes the new files when nothing holds the key any more", async () => {
    const key = await upload();
    const written = [thumb(key), display(key)];
    for (const at of written) await storage().writeDerivative(at, Buffer.from("jpeg"), "image/jpeg");

    expect(await renditionsMade(family, key, written)).toBe(0);
    expect(await runJobs()).toEqual(["media.purge"]);
    expect(await exists(thumb(key))).toBe(false);
    expect(await exists(display(key))).toBe(false);
  });

  it("leaves them when the only Holder left is a memory photo", async () => {
    const key = await upload();
    await memoryPhoto(key);
    expect(await renditionsMade(family, key, [thumb(key), display(key)])).toBe(0);
    await runJobs();
    expect(await filesOf(key)).toEqual({ original: true, thumb: true, display: true });
  });
});

describe("deleteIfUnused", () => {
  it("deletes what nothing holds, keeps what something does, and never touches another family's keys", async () => {
    const free = await upload();
    const held = await upload();
    await setPicture(family, { personId: person }, held);
    const foreign = `someoneelse/${crypto.randomUUID()}/original.jpg`;

    const outcome = await deleteIfUnused(family, [free, held, thumb(held), foreign]);
    expect(outcome.deleted).toEqual([free, thumb(free), display(free)]);
    expect(outcome.kept).toEqual([held, thumb(held)]);
    expect(outcome.refused).toEqual([foreign]);
    expect(await exists(free)).toBe(false);
    expect(await exists(held)).toBe(true);
  });
});

describe("the race between setPicture and deleteIfUnused on one key", () => {
  it("a set that arrives during the delete waits for it, then finds the file gone and refuses", async () => {
    const key = await upload();
    const inDelete = deferred();
    const release = deferred();
    const purge = storage().purgeForFamilyDelete.bind(storage());
    vi.spyOn(storage(), "purgeForFamilyDelete").mockImplementation(async (k) => {
      inDelete.resolve();
      await release.promise;
      return purge(k);
    });

    const deleting = deleteIfUnused(family, [key]);
    await inDelete.promise; // checked "not in use", about to delete, holding the lock
    let settled = false;
    const setting = setPicture(family, { personId: person }, key).finally(() => {
      settled = true;
    });
    await sleep(300);
    expect(settled).toBe(false);

    release.resolve();
    expect((await deleting).deleted).toContain(key);
    expect(await setting).toEqual({ ok: false, problem: "missing" });
    expect(await exists(key)).toBe(false);
    expect(await personRow()).toMatchObject({ photoKey: null });
  });

  it("a delete that arrives during the set waits for it, then finds the key held and keeps it", async () => {
    const key = await upload();
    const inSet = deferred();
    const release = deferred();
    const head = storage().head.bind(storage());
    vi.spyOn(storage(), "head").mockImplementation(async (k) => {
      inSet.resolve();
      await release.promise;
      return head(k);
    });

    const setting = setPicture(family, { personId: person }, key);
    await inSet.promise; // holding the lock, checking the file is there
    let settled = false;
    const deleting = deleteIfUnused(family, [key]).finally(() => {
      settled = true;
    });
    await sleep(300);
    expect(settled).toBe(false);

    release.resolve();
    expect(await setting).toEqual({ ok: true });
    expect((await deleting).kept).toEqual([key]);
    expect(await exists(key)).toBe(true);
    expect(await personRow()).toMatchObject({ photoKey: key });
  });
});
