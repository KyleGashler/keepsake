import crypto from "node:crypto";
import { Router } from "express";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import {
  ALLOWED_MIME_TYPES,
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

/** Generated stand-in imagery — see lib/placeholder.ts for why these exist. */
mediaBytesRouter.get("/gen/:seed.png", (req, res) => {
  const seed = String(req.params.seed ?? "keepsake");
  const clamp = (v: unknown, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(2000, Math.max(16, Math.round(n))) : d;
  };
  // `c` pins the gradient to one colour — avatars pass the person's own.
  const base = typeof req.query.c === "string" ? req.query.c : null;
  const png = placeholderPng(seed, clamp(req.query.w, 1200), clamp(req.query.h, 900), base);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

// ---------------------------------------------------------------------------
// The local stand-in for a bucket's endpoint.
//
// Both routes are public on purpose: the signed token *is* the authorisation,
// exactly as a presigned S3 URL carries its own. When B2 lands they become
// dead code for a deployment pointed at S3 — the client PUTs to Amazon
// instead — which is why they hold no business logic.
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
    claims = provider.verifyUploadToken(String(req.params.token));
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

  // Streamed to disk: a 100 MB video must never sit in this process's heap.
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
    claims = provider.verifyReadToken(String(req.params.token));
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
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  filename: z.string().max(255).optional(),
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

  const { mimeType, bytes } = parsed.data;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(415).json({ error: `Unsupported media type: ${mimeType}` });
  }

  const uploadId = crypto.randomUUID();
  const key = originalKey(family.id, uploadId, extensionFor(mimeType));
  const target = await storage().createUploadTarget({ key, mimeType, bytes });

  res.status(201).json({ uploadId, key, target });
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

  const declared = contentTypeForKey(key);
  const head = await readHead(await provider.stream(key), 4100);
  const sniffed = await fileTypeFromBuffer(head);

  if (!sniffed) {
    return res.status(415).json({ error: "Could not identify the uploaded file from its contents" });
  }
  if (!sniffedTypeMatches(declared, sniffed.mime)) {
    return res.status(415).json({
      error: `Uploaded bytes are ${sniffed.mime}, not the declared ${declared}`,
    });
  }

  const sha256 = await hashObject(await provider.stream(key));
  const dimensions = mediaTypeFor(declared) === "PHOTO" ? measure(head) : null;

  res.json({
    media: {
      key,
      type: mediaTypeFor(declared),
      mimeType: declared,
      bytes: meta.bytes,
      sha256,
      ...(dimensions ?? {}),
    },
  });
});

function keyBelongsTo(key: string, familyId: string) {
  return key.startsWith(`${familyId}/`);
}

/** Enough of the object to identify it and read an image header. */
async function readHead(source: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    total += chunk.length;
    if (total >= limit) break;
  }
  // The stream is abandoned mid-read; without this the file handle leaks.
  (source as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  return Buffer.concat(chunks).subarray(0, limit);
}

async function hashObject(source: NodeJS.ReadableStream): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of source as AsyncIterable<Buffer>) hash.update(chunk);
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
