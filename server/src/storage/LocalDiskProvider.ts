import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "../lib/logger.js";
import {
  StorageKeyError,
  UPLOAD_URL_TTL_SECONDS,
  assertDeletable,
  assertSafeKey,
  assertUploadable,
  type StorageProvider,
  type UploadTarget,
} from "./StorageProvider.js";

/**
 * Media root. In Docker this is a volume; locally it defaults to `server/media`.
 * Originals live under `objects/`. The sibling `uploads/` is the pre-A5
 * directory, still served read-only so demo files uploaded before the
 * two-phase path existed keep resolving.
 */
export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve("media");
export const OBJECTS_DIR = path.join(MEDIA_DIR, "objects");

const DEV_SECRET = "keepsake-dev-media-signing-secret";
const SIGNING_SECRET = resolveSecret();

function resolveSecret() {
  const configured = process.env.MEDIA_SIGNING_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    // Not fatal — a demo box that loses its media is recoverable, a box that
    // won't boot isn't — but anyone who can read this repo can mint tokens.
    logger.error("MEDIA_SIGNING_SECRET is unset in production; upload/read tokens use a public dev key");
  }
  return DEV_SECRET;
}

/** Upload tokens authorise a write; read tokens authorise a GET. Never interchangeable. */
type TokenScope = "u" | "r";

type UploadClaims = { key: string; mimeType: string; bytes: number; expiresAt: Date };
type ReadClaims = { key: string; expiresAt: Date };

type Payload = { v: 1; s: TokenScope; k: string; e: number; m?: string; b?: number };

export class SignatureError extends Error {}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string, scope: TokenScope): Payload {
  const [body, sig] = String(token).split(".");
  if (!body || !sig) throw new SignatureError("Malformed token");

  const expected = crypto.createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  // Constant-time: a length mismatch alone would otherwise leak through timing.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new SignatureError("Bad signature");

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    throw new SignatureError("Unreadable token");
  }
  if (payload.v !== 1 || payload.s !== scope) throw new SignatureError("Wrong token type");
  if (!Number.isFinite(payload.e) || payload.e * 1000 < Date.now()) throw new SignatureError("Token expired");
  assertSafeKey(payload.k);
  return payload;
}

/**
 * Originals on a local volume, addressed exactly the way S3 addresses them.
 *
 * The one thing a bucket gives you that a disk doesn't is a presigned URL, so
 * this provider mints its own: an HMAC over (key, type, size, expiry) that the
 * `/media/local-upload` and `/media/o` routes verify. Those two routes are the
 * local stand-in for S3's endpoint, and they're the only public surface here —
 * the token *is* the authorisation, which is why they sit outside `/api`.
 */
export class LocalDiskProvider implements StorageProvider {
  constructor() {
    fs.mkdirSync(OBJECTS_DIR, { recursive: true });
  }

  async createUploadTarget(input: { key: string; mimeType: string; bytes: number }): Promise<UploadTarget> {
    assertUploadable(input);
    const expires = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    const token = sign({
      v: 1,
      s: "u",
      k: input.key,
      m: input.mimeType,
      b: input.bytes,
      e: Math.floor(expires.getTime() / 1000),
    });
    return {
      // Relative: the client resolves it against the API origin, so this works
      // unchanged on localhost, on a LAN address, and behind the Fly hostname.
      url: `/media/local-upload/${token}`,
      method: "PUT",
      headers: { "Content-Type": input.mimeType },
      expiresAt: expires.toISOString(),
    };
  }

  async head(key: string): Promise<{ bytes: number } | null> {
    assertSafeKey(key);
    try {
      const stat = await fsp.stat(this.pathFor(key));
      return stat.isFile() ? { bytes: stat.size } : null;
    } catch {
      return null;
    }
  }

  /**
   * Always true: `/media/local-upload` refuses to write a key that already
   * exists and lands each object with an atomic rename, so a second write can't
   * happen here. (S3 has to check after the fact; see S3StorageProvider.)
   */
  async writtenOnce(key: string): Promise<boolean> {
    assertSafeKey(key);
    return true;
  }

  async getReadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const token = sign({ v: 1, s: "r", k: key, e: Math.floor(Date.now() / 1000) + ttlSeconds });
    return `/media/o/${token}`;
  }

  async stream(key: string): Promise<NodeJS.ReadableStream> {
    assertSafeKey(key);
    return fs.createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    assertDeletable(key);
    await fsp.rm(this.pathFor(key), { force: true });
  }

  async healthCheck(): Promise<boolean> {
    await fsp.access(OBJECTS_DIR, fs.constants.W_OK);
    return true;
  }

  // ---- Local-only: the routes that stand in for S3's endpoint ---------------

  verifyUploadToken(token: string): UploadClaims {
    const p = verify(token, "u");
    if (!p.m || !Number.isInteger(p.b)) throw new SignatureError("Incomplete upload token");
    return { key: p.k, mimeType: p.m, bytes: p.b as number, expiresAt: new Date(p.e * 1000) };
  }

  verifyReadToken(token: string): ReadClaims {
    const p = verify(token, "r");
    return { key: p.k, expiresAt: new Date(p.e * 1000) };
  }

  /**
   * Write `source` to `key`, streamed — a 100 MB video must never be held in
   * memory. Writes to a sibling `.part` file and renames, so a dropped
   * connection can't leave a truncated object that `head()` would call real.
   */
  async writeObject(key: string, source: NodeJS.ReadableStream): Promise<{ bytes: number }> {
    assertSafeKey(key);
    const target = this.pathFor(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const partial = `${target}.${crypto.randomUUID()}.part`;

    const sink = fs.createWriteStream(partial);
    try {
      await pipeline(source, sink);
      await fsp.rename(partial, target);
    } catch (err) {
      await fsp.rm(partial, { force: true });
      throw err;
    }
    return { bytes: sink.bytesWritten };
  }

  /** Discard a partial upload that failed validation. Originals only ever get here. */
  async discardObject(key: string): Promise<void> {
    assertSafeKey(key);
    await fsp.rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string) {
    const resolved = path.resolve(OBJECTS_DIR, key);
    // assertSafeKey already rules traversal out; this is the check that would
    // catch it if that regex is ever loosened.
    if (resolved !== OBJECTS_DIR && !resolved.startsWith(`${OBJECTS_DIR}${path.sep}`)) {
      throw new StorageKeyError("Storage key escapes the object root");
    }
    return resolved;
  }
}
