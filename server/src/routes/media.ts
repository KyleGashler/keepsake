import crypto from "node:crypto";
import type { Readable } from "node:stream";
import { Router } from "express";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { TRANSCRIBE_MAX_VIDEO_SECONDS } from "../jobs/transcribe.js";
import { logger } from "../lib/logger.js";
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
import { MAX_UPLOAD_BYTES, localProvider, originalKey, storage } from "../storage/index.js";
import { StorageKeyError } from "../storage/StorageProvider.js";

export { MEDIA_DIR };

/**
 * Build the provider at boot rather than on first upload: the local one
 * creates `MEDIA_DIR/objects` in its constructor (the health check probes it),
 * and an unrecognised `STORAGE_PROVIDER` should stop the process starting
 * rather than surface as a 500 the first time someone captures a memory.
 */
storage();

/**
 * Two routers, two mounts. `mediaBytesRouter` serves bytes at `/media` and is
 * public — the client renders these as plain `<img>` URLs, and the signed token
 * in each path is the credential. `mediaApiRouter` is the two-phase upload
 * handshake at `/api/media`, behind auth and the upload rate limiter.
 */
export const mediaBytesRouter = Router();
export const mediaApiRouter = Router();

/** A query-string dimension, kept to a size worth drawing. */
function clampDimension(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(2000, Math.max(16, Math.round(n))) : fallback;
}

/** Generated stand-in imagery — see lib/placeholder.ts for why these exist. */
mediaBytesRouter.get("/gen/:seed.png", (req, res) => {
  const seed = req.params.seed;
  // `c` pins the gradient to one colour — avatars pass the person's own.
  const base = typeof req.query.c === "string" ? req.query.c : null;
  const png = placeholderPng(seed, clampDimension(req.query.w, 1200), clampDimension(req.query.h, 900), base);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

// ---------------------------------------------------------------------------
// The local stand-in for a bucket's endpoint.
//
// Both routes are public on purpose: the signed token *is* the authorisation,
// exactly as a presigned S3 URL carries its own. With STORAGE_PROVIDER=s3 they
// answer 404 — the client PUTs to and reads from the bucket instead — which is
// why they hold no business logic.
// ---------------------------------------------------------------------------

/**
 * Receive one authorised upload. The token fixes the key, the declared type
 * and the exact byte count, so the only thing left to check is that the client
 * sent what it said it would.
 */
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

  // A key is written once. Replaying a still-valid token after finalize would
  // otherwise let the uploader swap the bytes under a recorded sha256 — and
  // originals are never overwritten.
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

/** Serve a stored object for the life of its read token. */
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

  const body = await provider.stream(claims.key);
  body.on("error", (err: Error) => {
    logger.error({ err, key: claims.key }, "failed streaming object");
    res.destroy(err);
  });
  body.pipe(res);
});

// ---------------------------------------------------------------------------
// Two-phase upload. These sit under /api, so they run after auth.
// ---------------------------------------------------------------------------

const initBody = z.object({
  mimeType: z.string().min(1).max(120),
  // The ceiling is checked separately below so it can answer 413 with the
  // number, rather than a validation error the client would have to parse.
  bytes: z.number().int().positive(),
  filename: z.string().max(255).optional(),
});

/**
 * What the client should check before it asks for anything: lets the capture
 * screen say "too big" the moment a file is picked, instead of after the
 * family has written the story. The server stays the one source of the number.
 */
mediaApiRouter.get("/limits", (_req, res) => {
  res.json({
    maxUploadBytes: MAX_UPLOAD_BYTES,
    // Longer videos are kept but not transcribed yet (TranscriptStatus.SKIPPED).
    transcribeMaxVideoSeconds: TRANSCRIBE_MAX_VIDEO_SECONDS,
  });
});

/**
 * Phase one: authorise an upload, store nothing.
 *
 * Deliberately no `Media` row yet. A row created here would need a `memoryId`
 * the client doesn't have (a memory is composed *after* its photographs are
 * picked), and every abandoned upload would leave an orphan behind. The key is
 * the only thing that has to survive between the two calls, and it's derived,
 * not stored — the family prefix is what proves ownership at finalize.
 */
mediaApiRouter.post("/init", async (req, res) => {
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

  const uploadId = crypto.randomUUID();
  const key = originalKey(family.id, uploadId, extensionFor(mimeType));
  const target = await storage().createUploadTarget({ key, mimeType, bytes });

  // `mimeType` is the normalised type the target was signed for; PUT with
  // `target.headers` exactly, not the type the client declared.
  res.status(201).json({ uploadId, key, mimeType, target });
});

const finalizeBody = z.object({ key: z.string().min(1).max(512) });

/**
 * Phase two: confirm what actually landed.
 *
 * The declared type from phase one is a claim; this is where it's checked
 * against the bytes. Returns the facts the memory route needs rather than
 * writing them — the `Media` row is created with the memory, in one
 * transaction, so a half-attached photograph is not a state that exists.
 *
 * A rejected or abandoned object is left on the volume rather than deleted.
 * Nothing references it, and the one rule this codebase will not bend is that
 * the delete path never runs against an `original.*` key; a sweeper that knows
 * which keys no `Media` row claims is the right owner of that cleanup.
 */
mediaApiRouter.post("/finalize", async (req, res) => {
  const family = req.ctx.family;
  const parsed = finalizeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { key } = parsed.data;

  // Every query filters by family; a storage key is no different.
  if (!keyBelongsTo(key, family.id)) return res.status(404).json({ error: "Upload not found" });

  const provider = storage();
  const meta = await provider.head(key);
  if (!meta) return res.status(404).json({ error: "Upload not found — PUT the bytes first" });
  if (meta.bytes > MAX_UPLOAD_BYTES) return res.status(413).json({ error: "Object too large" });

  if (meta.bytes <= 0) return res.status(415).json({ error: "The uploaded file is empty" });

  const declared = contentTypeForKey(key);
  // A ranged read: the sniff needs the first few KB, not a 2 GB download.
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

  // The object's digest. S3 already holds a full-object checksum it computed
  // as the bytes arrived, so record that rather than download the object to
  // hash it. Only a provider without one (local disk, emulators) gets read
  // end to end.
  const checksum = meta.checksum ?? null;
  const sha256 = checksum ? null : await hashObject(await provider.stream(key));

  // Checked last, so it covers the reads above: if anything wrote over the
  // upload — before finalize or while it was being hashed — the digest might
  // describe bytes that are no longer the object. See S3StorageProvider for
  // why this is a backstop and not the main guard.
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

/** How much finalize reads to sniff a type: file-type's own sample size. */
const SNIFF_BYTES = 4100;

/** Enough of the object to identify it and read an image header. */
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

/** Dimensions are a nicety: a header this tool can't read must not fail the upload. */
function measure(head: Buffer): { width: number; height: number } | null {
  try {
    const { width, height } = imageSize(head);
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}
