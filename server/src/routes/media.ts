import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { Router, type Request, type Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { requireContributor } from "../auth/middleware.js";
import { jobQueue } from "../jobs/index.js";
import { originAllowed } from "../lib/cors-origins.js";
import { isForeignKeyViolation } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { isMuxKey, kickSync, muxKey, snapshotPatch, updateMuxAsset, uploadIdFromKey, uploadPatch } from "../media-host/assets.js";
import { MediaHostError, mediaHost, type HostUpload } from "../media-host/index.js";
import { keyBelongsTo } from "../lib/upload-keys.js";
import {
  ALLOWED_MIME_TYPES,
  baseMimeType,
  contentTypeForKey,
  extensionFor,
  mediaTypeFor,
  sniffedTypeMatches,
} from "../lib/mime.js";
import { placeholderPng } from "../lib/placeholder.js";
import { MEDIA_DIR, SignatureError } from "../storage/LocalDiskProvider.js";
import { MAX_UPLOAD_BYTES, UPLOAD_URL_TTL_SECONDS, localProvider, originalKey, storage } from "../storage/index.js";
import { StorageKeyError, attachmentDisposition } from "../storage/StorageProvider.js";

export { MEDIA_DIR };

// Built at boot: an unrecognised STORAGE_PROVIDER must stop startup, and the
// local provider creates MEDIA_DIR/objects, which the health check probes.
storage();

// mediaBytesRouter is public on purpose: the signed token in each path is the
// credential, as a presigned S3 URL carries its own.
export const mediaBytesRouter = Router();
export const mediaApiRouter = Router();

function clampDimension(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(2000, Math.max(16, Math.round(n))) : fallback;
}

mediaBytesRouter.get("/gen/:seed.png", (req, res) => {
  const seed = req.params.seed;
  const base = typeof req.query.c === "string" ? req.query.c : null;
  const png = placeholderPng(seed, clampDimension(req.query.w, 1200), clampDimension(req.query.h, 900), base);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

mediaBytesRouter.put("/local-upload/:token", async (req, res) => {
  const provider = localProvider();
  if (!provider) return res.status(404).json({ error: "Local uploads are not enabled" });

  let claims;
  try {
    claims = provider.verifyUploadToken(req.params.token);
  } catch (err) {
    if (err instanceof SignatureError || err instanceof StorageKeyError) {
      return res.status(403).json({ error: err.message });
    }
    throw err;
  }

  const declaredLength = Number(req.headers["content-length"]);
  if (!Number.isInteger(declaredLength)) {
    return res.status(411).json({ error: "Content-Length required" });
  }
  if (declaredLength !== claims.bytes) {
    return res.status(400).json({
      error: `Content-Length ${declaredLength} does not match the authorised ${claims.bytes} bytes`,
    });
  }
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: `Uploads are limited to ${MAX_UPLOAD_BYTES} bytes` });
  }

  // Write-once: replaying a still-valid token after finalize would otherwise
  // swap the bytes under a recorded sha256.
  if (await provider.head(claims.key)) {
    return res.status(409).json({ error: "An object already exists at this key" });
  }

  // Streamed to disk: a 2 GB video must never sit in this process's heap.
  const written = await provider.writeObject(claims.key, req);
  if (written.bytes !== claims.bytes) {
    await provider.discardObject(claims.key);
    return res.status(400).json({
      error: `Received ${written.bytes} bytes, expected ${claims.bytes}`,
    });
  }

  res.status(201).json({ key: claims.key, bytes: written.bytes });
});

mediaBytesRouter.get("/o/:token", async (req, res) => {
  const provider = localProvider();
  if (!provider) return res.status(404).json({ error: "Local reads are not enabled" });

  let claims;
  try {
    claims = provider.verifyReadToken(req.params.token);
  } catch (err) {
    if (err instanceof SignatureError || err instanceof StorageKeyError) {
      return res.status(403).json({ error: err.message });
    }
    throw err;
  }

  const meta = await provider.head(claims.key);
  if (!meta) return res.status(404).json({ error: "Not found" });

  const remaining = Math.max(0, Math.floor((claims.expiresAt.getTime() - Date.now()) / 1000));
  res.setHeader("Content-Type", contentTypeForKey(claims.key));
  res.setHeader("Content-Length", String(meta.bytes));
  // Family media is not public: a shared cache must never hold it, and a
  // browser must not hold it longer than the token that fetched it is valid.
  res.setHeader("Cache-Control", `private, max-age=${remaining}`);
  if (claims.downloadAs) res.setHeader("Content-Disposition", attachmentDisposition(claims.downloadAs));

  const body = await provider.stream(claims.key);
  body.on("error", (err: Error) => {
    logger.error({ err, key: claims.key }, "failed streaming object");
    res.destroy(err);
  });
  body.pipe(res);
});

const initBody = z.object({
  mimeType: z.string().min(1).max(120),
  // The ceiling is checked below so it can answer 413 with the number.
  bytes: z.number().int().positive(),
  filename: z.string().max(255).optional(),
});

mediaApiRouter.get("/limits", (_req, res) => {
  res.json({ maxUploadBytes: MAX_UPLOAD_BYTES });
});

const AV_UNAVAILABLE = {
  error: "Video and audio uploads aren't available on this server yet",
  code: "av_unavailable",
} as const;

// Stores nothing: the key's family prefix is what proves ownership at finalize.
mediaApiRouter.post("/init", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = initBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { bytes } = parsed.data;
  // `audio/webm;codecs=opus` is what MediaRecorder reports; the parameters
  // describe the stream inside the container, not the container itself.
  const mimeType = baseMimeType(parsed.data.mimeType);
  if (bytes > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: `Uploads are limited to ${MAX_UPLOAD_BYTES} bytes`,
      code: "too_large",
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(415).json({ error: `Unsupported media type: ${mimeType}` });
  }

  const type = mediaTypeFor(mimeType);
  if (type !== "PHOTO") {
    // The MuxAsset row records that this family asked for the upload;
    // finalize and POST /memories check it.
    const host = mediaHost();
    if (!host) return res.status(503).json(AV_UNAVAILABLE);

    // A browser PUTs cross-origin, so Mux must allow the page's origin — but
    // only one this API itself would answer. Native clients send no Origin.
    const origin = req.get("origin");
    if (origin && !originAllowed(origin, req)) {
      return res.status(403).json({ error: "This origin may not upload", code: "origin_not_allowed" });
    }
    let upload: HostUpload;
    try {
      upload = await host.createUpload({ type, corsOrigin: origin ?? "*", passthrough: family.id });
    } catch (err) {
      if (!(err instanceof MediaHostError)) throw err;
      req.log.error({ err }, "Mux direct upload failed");
      return res.status(502).json({ error: "Couldn't reach the video service; try again", code: "media_host_error" });
    }
    if (!upload.url) throw new Error("Mux returned a direct upload without a URL");
    try {
      await prisma.muxAsset.create({
        data: { familyId: family.id, uploadId: upload.id, type, mimeType, bytes },
      });
    } catch (err) {
      if (!isForeignKeyViolation(err)) throw err;
      // The family was deleted mid-request: cancel so later bytes never become
      // an asset. Best effort — the URL lapses on its own.
      await host.cancelUpload(upload.id).catch((cancelErr: unknown) => {
        req.log.warn({ err: cancelErr, uploadId: upload.id }, "couldn't cancel a Mux upload for a deleted family");
      });
      return res.status(403).json({ error: "forbidden" });
    }
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
    // Mux's URL is a plain signed PUT that takes the file as the body.
    return res.status(201).json({
      uploadId: upload.id,
      key: muxKey(upload.id),
      mimeType,
      target: { url: upload.url, method: "PUT", headers: {}, expiresAt },
    });
  }

  const uploadId = crypto.randomUUID();
  const key = originalKey(family.id, uploadId, extensionFor(mimeType));
  const target = await storage().createUploadTarget({ key, mimeType, bytes });

  // The client must PUT with `target.headers` exactly: they were signed.
  res.status(201).json({ uploadId, key, mimeType, target });
});

const finalizeBody = z.object({ key: z.string().min(1).max(512) });

// A rejected object is left in place: the delete path must never run against
// an `original.*` key.
mediaApiRouter.post("/finalize", requireContributor, async (req, res) => {
  const family = req.ctx.family;
  const parsed = finalizeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { key } = parsed.data;

  if (isMuxKey(key)) return finalizeMux(req, res, key);

  if (!keyBelongsTo(key, family.id)) return res.status(404).json({ error: "Upload not found" });

  const provider = storage();
  const meta = await provider.head(key);
  if (!meta) return res.status(404).json({ error: "Upload not found — PUT the bytes first" });
  if (meta.bytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Object too large" });

  if (meta.bytes <= 0) return res.status(415).json({ error: "The uploaded file is empty" });

  const declared = contentTypeForKey(key);
  const head = await readHead(await provider.stream(key, { start: 0, end: SNIFF_BYTES - 1 }), SNIFF_BYTES);
  const sniffed = await fileTypeFromBuffer(head);

  if (!sniffed) {
    return res.status(415).json({ error: "Could not identify the uploaded file from its contents" });
  }
  if (!sniffedTypeMatches(declared, sniffed.mime)) {
    return res.status(415).json({
      error: `Uploaded bytes are ${sniffed.mime}, not the declared ${declared}`,
    });
  }

  // S3 already holds a full-object checksum; only providers without one get
  // read end to end.
  const checksum = meta.checksum ?? null;
  const sha256 = checksum ? null : await hashObject(await provider.stream(key));

  // Checked last so it covers the reads above: an overwrite during hashing
  // would leave the digest describing other bytes.
  if (!(await provider.writtenOnce(key))) {
    return res.status(409).json({
      error: "This upload was written more than once; upload the file again",
    });
  }

  const dimensions = mediaTypeFor(declared) === "PHOTO" ? measure(head) : null;

  res.json({
    media: {
      key,
      type: mediaTypeFor(declared),
      mimeType: declared,
      bytes: meta.bytes,
      // Exactly one of these is set; pass both back to POST /memories as is.
      sha256,
      checksum,
      ...dimensions,
    },
  });
});

const MUX_FINALIZE_WAIT_MS = 8_000;
const MUX_FINALIZE_POLL_MS = 1_000;

// No sniff: Mux decodes the file itself and fails the asset if it can't. It
// creates the asset a moment after the PUT returns, hence the brief poll.
async function finalizeMux(req: Request, res: Response, key: string) {
  const family = req.ctx.family;
  const row = await prisma.muxAsset.findFirst({ where: { uploadId: uploadIdFromKey(key), familyId: family.id } });
  if (!row) return res.status(404).json({ error: "Upload not found" });

  const host = mediaHost();
  if (!host) return res.status(503).json(AV_UNAVAILABLE);

  let upload: HostUpload;
  try {
    upload = await host.getUpload(row.uploadId);
    const deadline = Date.now() + MUX_FINALIZE_WAIT_MS;
    while (upload.status === "waiting" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MUX_FINALIZE_POLL_MS));
      upload = await host.getUpload(row.uploadId);
    }
  } catch (err) {
    if (err instanceof MediaHostError) {
      req.log.error({ err }, "Mux upload lookup failed");
      return res.status(502).json({ error: "Couldn't reach the video service; try again", code: "media_host_error" });
    }
    throw err;
  }

  if (upload.passthrough !== family.id) return res.status(404).json({ error: "Upload not found" });
  if (upload.status === "waiting") {
    return res.status(409).json({ error: "The upload hasn't arrived yet — PUT the file first", code: "upload_incomplete" });
  }

  let settled = await updateMuxAsset({ id: row.id }, (r) => uploadPatch(r, upload));
  if (upload.status !== "asset_created" || !settled) {
    return res.status(422).json({
      error: `The upload ${upload.status === "timed_out" ? "expired" : "failed"}; upload the file again`,
      code: "upload_failed",
    });
  }

  if (upload.assetId) {
    try {
      const snap = await host.getAsset(upload.assetId);
      settled = (await updateMuxAsset({ id: row.id }, (r) => snapshotPatch(r, snap))) ?? settled;
    } catch (err) {
      req.log.warn({ err }, "Mux asset read at finalize failed; mux.sync will retry");
    }
  }
  await kickSync(jobQueue(), row.id);

  res.json({
    media: {
      key,
      type: settled.type,
      mimeType: settled.mimeType,
      bytes: settled.bytes,
      sha256: null,
      checksum: null,
    },
  });
}

// file-type's own sample size.
const SNIFF_BYTES = 4100;

async function readHead(source: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    if (!Buffer.isBuffer(chunk)) throw new TypeError("Expected a byte stream");
    chunks.push(chunk);
    total += chunk.length;
    if (total >= limit) break;
  }
  // The stream may be abandoned mid-read; without this the file handle leaks.
  source.destroy();
  return Buffer.concat(chunks).subarray(0, limit);
}

async function hashObject(source: Readable): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of source) hash.update(chunk);
  return hash.digest("hex");
}

function measure(head: Buffer): { width: number; height: number } | null {
  try {
    const { width, height } = imageSize(head);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}
