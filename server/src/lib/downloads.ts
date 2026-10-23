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

/**
 * Per-memory download (A17): every file a memory holds, as something a
 * person can save — the reason account and family deletion can say
 * "download what you want to keep first".
 *
 * - **Photos** are the original bytes: a short-lived storage read URL that
 *   answers `Content-Disposition: attachment`.
 * - **Recordings** are Mux's `audio.m4a` rendition (what plays), signed with
 *   Mux's `download` option so it saves under our filename.
 * - **Videos** (and a recording whose m4a never came) are Mux's master, the
 *   full-quality copy Mux keeps, through *temporary master access*: asked
 *   for on the first download, ready a little later, then good for 24 hours
 *   from the request. Until it's ready the file is `preparing`, and the
 *   client asks again. Mux refuses a second request while a master exists,
 *   so the state lives on the MuxAsset row (`master*`), fed by this module
 *   and by the `video.asset.master.*` webhooks.
 *
 * The demo family's generated placeholder images aren't files anyone
 * uploaded: they're counted as `unavailable`, not listed.
 */

export type DownloadStatus = "ready" | "preparing" | "failed";

export type DownloadFile = {
  mediaId: string;
  type: MediaType;
  filename: string;
  status: DownloadStatus;
  /** Only when ready. Absolute, except a local-disk photo (`/media/o/…`, relative to the API). */
  url?: string;
  /** ISO-8601; when `url` stops working. */
  expiresAt?: string;
};

/** Look at Mux for a preparing master at most this often (the client polls every ~10s). */
const MASTER_RECHECK_MS = 8_000;
/** After Mux failed to prepare a master, wait this long before asking again. */
const MASTER_RETRY_AFTER_ERROR_MS = 60_000;
/** Don't hand out a master URL this close to lapsing; a download needs time to start. */
const MASTER_MIN_REMAINING_MS = 2 * 60_000;

/**
 * The memory's files, in the family's order (`Media.sortOrder`). Null when
 * the memory isn't this family's. Safe to call repeatedly — it's what the
 * client polls: a master already asked for is only looked at, never asked
 * for again until it lapses or failed.
 */
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
        // One clip's trouble with Mux shouldn't sink the whole list. A
        // retryable failure stays `preparing`, so the client asks again.
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
    // A photo, as uploaded. (Only rows with a key get here.)
    if (!m.storageKey) return { status: "failed" };
    const url = await storage().getReadUrl(m.storageKey, READ_URL_TTL_SECONDS, { downloadAs: filename });
    return { status: "ready", url, expiresAt: after(now, READ_URL_TTL_SECONDS * 1000) };
  }
  if (!host) return { status: "failed" }; // No Mux credentials on this server.
  if (asset.status === "FAILED") return { status: "failed" };
  // Still uploading or transcoding: nothing to download yet.
  if (asset.status !== "READY" || !asset.assetId) return { status: "preparing" };

  if (m.type === "AUDIO" && asset.renditionStatus === "ready" && asset.playbackId) {
    // Signed for at least READ_URL_TTL_SECONDS from now (see MuxMediaHost#sign).
    const url = await host.audioDownloadUrl(asset.playbackId, filename);
    return { status: "ready", url, expiresAt: after(now, READ_URL_TTL_SECONDS * 1000) };
  }
  return masterFile(host, asset, asset.assetId, filename, now);
}

/** The asset's master: hand it out if ready, look again if preparing, ask if there's none. */
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
      // Mux has no master after all (withdrawn early, or the request was
      // lost): forget ours and ask again below.
      row = await update((r) => masterGonePatch(r));
    }
  }
  if (row.masterStatus === "errored" && checkedWithin(row, now, MASTER_RETRY_AFTER_ERROR_MS)) {
    return { status: "failed" };
  }

  // Never asked, lapsed, or failed a while ago: ask.
  const result = await host.requestMaster(assetId);
  row = await update((r) => masterRequestedPatch(r, result, now));
  return readyMaster(row, filename, now) ?? { status: row.masterStatus === "errored" ? "failed" : "preparing" };
}

/**
 * The master as a ready file, or null when there's no URL with time left on
 * it. The URL is Mux's with `download=<filename>` added — the one change
 * Mux allows to it, which makes the response an attachment under that name.
 */
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

/**
 * The saved file's extension. A photo keeps its original's (from the storage
 * key, which init derived from the type). A recording is the m4a rendition,
 * or an audio-only master, which is MP4-contained audio too; a video's
 * master is an MP4.
 */
function extensionOf(m: MediaRow): string {
  if (m.muxAsset) return m.type === "AUDIO" ? ".m4a" : ".mp4";
  const key = m.storageKey ?? "";
  const dot = key.lastIndexOf(".");
  const fromKey = dot === -1 ? "" : key.slice(dot).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(fromKey) ? fromKey : extensionFor(m.mimeType ?? "") || ".bin";
}

/**
 * The memory's date as YYYY-MM-DD in the person's time zone (the client
 * sends it; the app picks dates in local time), else UTC.
 */
export function calendarDay(date: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      // en-CA formats a date as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        date,
      );
    } catch {
      // Not a zone this runtime knows: fall through to UTC.
    }
  }
  return date.toISOString().slice(0, 10);
}

const MAX_SLUG = 60;

/**
 * `first-day-of-school-2024-09-03-2.jpg`: the title as plain ASCII words,
 * the date, the file's place among the memory's files (only when there's
 * more than one, zero-padded so they sort), and the extension. Safe in any
 * filesystem and in a URL; "memory" when the title has nothing usable.
 */
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
