import type { MediaType, MuxAsset } from "@prisma/client";
import type { Logger } from "pino";
import {
  masterGonePatch,
  masterPatch,
  masterRequestedPatch,
  updateMuxAsset,
} from "../media-host/assets.js";
import { MediaHostError, mediaHost, type MediaHost } from "../media-host/index.js";
import { READ_URL_TTL_SECONDS, storage } from "../storage/index.js";
import { prisma } from "./prisma.js";
import { extensionFor } from "./mime.js";
import { mediaInclude, type MediaRow } from "./serialize.js";

export type DownloadStatus = "ready" | "preparing" | "failed";

export type DownloadFile = {
  mediaId: string;
  type: MediaType;
  filename: string;
  status: DownloadStatus;
  // Absolute, except a local-disk photo (`/media/o/…`, relative to the API).
  url?: string;
  expiresAt?: string;
};

const MASTER_RECHECK_MS = 8_000;
const MASTER_RETRY_AFTER_ERROR_MS = 60_000;
const MASTER_MIN_REMAINING_MS = 2 * 60_000;

export async function memoryDownloads(
  familyId: string,
  memoryId: string,
  options: { timeZone?: string; log: Logger },
): Promise<{ files: DownloadFile[]; unavailable: number } | null> {
  const memory = await prisma.memory.findFirst({
    where: { id: memoryId, familyId },
    select: { title: true, occurredAt: true, media: mediaInclude },
  });
  if (!memory) return null;

  const downloadable = memory.media.filter(
    (m) => (m.muxAsset ? m.muxAsset.familyId === familyId : Boolean(m.storageKey)),
  );
  const day = calendarDay(memory.occurredAt, options.timeZone);
  const host = mediaHost();
  const now = new Date();

  const files = await Promise.all(
    downloadable.map(async (m, index): Promise<DownloadFile> => {
      const filename = downloadFilename(memory.title, day, index, downloadable.length, extensionOf(m));
      const base = { mediaId: m.id, type: m.type, filename };
      try {
        return { ...base, ...(await fileFor(m, filename, host, now)) };
      } catch (err) {
        if (!(err instanceof MediaHostError)) throw err;
        options.log.warn({ err, mediaId: m.id }, "download: Mux request failed");
        return { ...base, status: err.retryable ? "preparing" : "failed" };
      }
    }),
  );
  return { files, unavailable: memory.media.length - downloadable.length };
}

type FileState = Pick<DownloadFile, "status" | "url" | "expiresAt">;

async function fileFor(m: MediaRow, filename: string, host: MediaHost | null, now: Date): Promise<FileState> {
  const asset = m.muxAsset;
  if (!asset) {
    if (!m.storageKey) return { status: "failed" };
    const url = await storage().getReadUrl(m.storageKey, READ_URL_TTL_SECONDS, { downloadAs: filename });
    return { status: "ready", url, expiresAt: after(now, READ_URL_TTL_SECONDS * 1000) };
  }
  if (!host) return { status: "failed" }; // No Mux credentials on this server.
  if (asset.status === "FAILED") return { status: "failed" };
  if (asset.status !== "READY" || !asset.assetId) return { status: "preparing" };

  if (m.type === "AUDIO" && asset.renditionStatus === "ready" && asset.playbackId) {
    const url = await host.audioDownloadUrl(asset.playbackId, filename);
    return { status: "ready", url, expiresAt: after(now, READ_URL_TTL_SECONDS * 1000) };
  }
  return masterFile(host, asset, asset.assetId, filename, now);
}

// Mux refuses a second temporary-master request while one exists (each lasts 24h from the
// request), so the master's state lives on the MuxAsset row.
async function masterFile(
  host: MediaHost,
  initial: MuxAsset,
  assetId: string,
  filename: string,
  now: Date,
): Promise<FileState> {
  let row = initial;
  const update = async (patch: Parameters<typeof updateMuxAsset>[1]) =>
    (await updateMuxAsset({ id: row.id }, patch)) ?? row;

  const ready = readyMaster(row, filename, now);
  if (ready) return ready;

  const live = row.masterExpiresAt !== null && row.masterExpiresAt > now;
  if (row.masterStatus === "preparing" && live) {
    if (checkedWithin(row, now, MASTER_RECHECK_MS)) return { status: "preparing" };
    const snap = await host.getAsset(assetId);
    if (snap.master?.status) {
      row = await update((r) => ({ ...masterPatch(r, snap.master), masterCheckedAt: now }));
      const nowReady = readyMaster(row, filename, now);
      if (nowReady) return nowReady;
      if (row.masterStatus !== "errored") return { status: "preparing" };
    } else {
      // Mux withdrew the master early or lost the request.
      row = await update((r) => masterGonePatch(r));
    }
  }
  if (row.masterStatus === "errored" && checkedWithin(row, now, MASTER_RETRY_AFTER_ERROR_MS)) {
    return { status: "failed" };
  }

  const result = await host.requestMaster(assetId);
  row = await update((r) => masterRequestedPatch(r, result, now));
  return readyMaster(row, filename, now) ?? { status: row.masterStatus === "errored" ? "failed" : "preparing" };
}

// Appending `download=<filename>` is the one change Mux allows to the URL; it makes the
// response an attachment under that name.
function readyMaster(row: MuxAsset, filename: string, now: Date): FileState | null {
  const { masterUrl: url, masterExpiresAt: expires } = row;
  if (row.masterStatus !== "ready" || !url || !expires) return null;
  if (expires.getTime() - now.getTime() <= MASTER_MIN_REMAINING_MS) return null;
  const sep = url.includes("?") ? "&" : "?";
  return {
    status: "ready",
    url: `${url}${sep}download=${encodeURIComponent(filename)}`,
    expiresAt: expires.toISOString(),
  };
}

function checkedWithin(row: MuxAsset, now: Date, ms: number) {
  return row.masterCheckedAt !== null && now.getTime() - row.masterCheckedAt.getTime() < ms;
}

function after(now: Date, ms: number) {
  return new Date(now.getTime() + ms).toISOString();
}

function extensionOf(m: MediaRow): string {
  if (m.muxAsset) return m.type === "AUDIO" ? ".m4a" : ".mp4";
  const key = m.storageKey ?? "";
  const dot = key.lastIndexOf(".");
  const fromKey = dot === -1 ? "" : key.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(fromKey) ? fromKey : extensionFor(m.mimeType ?? "") || ".bin";
}

export function calendarDay(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      // en-CA formats a date as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        date,
      );
    } catch {
      // Not a zone this runtime knows.
    }
  }
  return date.toISOString().slice(0, 10);
}

const MAX_SLUG = 60;

export function downloadFilename(title: string, day: string, index: number, total: number, ext: string): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_SLUG)
      .replace(/-+$/, "") || "memory";
  const n = total > 1 ? `-${String(index + 1).padStart(String(total).length, "0")}` : "";
  return `${slug}-${day}${n}${ext}`;
}
