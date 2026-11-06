import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { logger } from "../lib/logger.js";
import {
  StorageKeyError,
  UPLOAD_URL_TTL_SECONDS,
  assertDeletable,
  assertDerivativeWritable,
  assertFamilyPrefix,
  assertSafeKey,
  assertUploadable,
  type ByteRange,
  type ObjectHead,
  type ReadUrlOptions,
  type StorageProvider,
  type UploadTarget,
} from "./StorageProvider.js";

export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve("media");
export const OBJECTS_DIR = path.join(MEDIA_DIR, "objects");

const DEV_SECRET = "littlebylittle-dev-media-signing-secret";
const SIGNING_SECRET = resolveSecret();

function resolveSecret() {
  const configured = process.env.MEDIA_SIGNING_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    // Not fatal, since a box that won't boot is worse, but anyone who can read this repo can mint tokens.
    logger.error("MEDIA_SIGNING_SECRET is unset in production; upload/read tokens use a public dev key");
  }
  return DEV_SECRET;
}

type TokenScope = "u" | "r";

type UploadClaims = { key: string; mimeType: string; bytes: number; expiresAt: Date };
type ReadClaims = { key: string; expiresAt: Date; downloadAs?: string };

type Payload = { v: 1; s: TokenScope; k: string; e: number; m?: string; b?: number; d?: string };

export class SignatureError extends Error {}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SIGNING_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string, scope: TokenScope): Payload {
  const [body, sig] = token.split(".");
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

// A disk has no presigned URLs, so this mints HMAC tokens that the public `/media/local-upload`
// and `/media/o` routes verify; the token is the whole authorisation.
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
      // Relative, so the client resolves it against whatever API origin it reached.
      url: `/media/local-upload/${token}`,
      method: "PUT",
      headers: { "Content-Type": input.mimeType },
      expiresAt: expires.toISOString(),
    };
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertSafeKey(key);
    try {
      const stat = await fsp.stat(this.pathFor(key));
      return stat.isFile() ? { bytes: stat.size } : null;
    } catch {
      return null;
    }
  }

  // The upload route refuses existing keys and lands each with an atomic rename.
  async writtenOnce(key: string): Promise<boolean> {
    assertSafeKey(key);
    return true;
  }

  async getReadUrl(key: string, ttlSeconds: number, options?: ReadUrlOptions): Promise<string> {
    assertSafeKey(key);
    const token = sign({
      v: 1,
      s: "r",
      k: key,
      e: Math.floor(Date.now() / 1000) + ttlSeconds,
      ...(options?.downloadAs ? { d: options.downloadAs } : {}),
    });
    return `/media/o/${token}`;
  }

  async stream(key: string, range?: ByteRange): Promise<Readable> {
    assertSafeKey(key);
    // `end` is inclusive here too, so a range means the same thing on both providers.
    return fs.createReadStream(this.pathFor(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async writeDerivative(key: string, body: Buffer, _contentType: string): Promise<void> {
    assertDerivativeWritable(key);
    await this.writeObject(key, Readable.from([body]));
  }

  async delete(key: string): Promise<void> {
    assertDeletable(key);
    await fsp.rm(this.pathFor(key), { force: true });
  }

  async purgeForFamilyDelete(key: string): Promise<void> {
    assertSafeKey(key);
    const target = this.pathFor(key);
    await fsp.rm(target, { force: true });
    // Fails while a sibling rendition remains, which is fine.
    await fsp.rmdir(path.dirname(target)).catch(() => undefined);
  }

  async purgeFamilyObjects(familyId: string): Promise<void> {
    assertFamilyPrefix(familyId);
    await fsp.rm(this.pathFor(familyId), { recursive: true, force: true });
  }

  async healthCheck(): Promise<boolean> {
    await fsp.access(OBJECTS_DIR, fs.constants.W_OK);
    return true;
  }

  verifyUploadToken(token: string): UploadClaims {
    const p = verify(token, "u");
    if (!p.m || p.b === undefined || !Number.isInteger(p.b)) throw new SignatureError("Incomplete upload token");
    return { key: p.k, mimeType: p.m, bytes: p.b, expiresAt: new Date(p.e * 1000) };
  }

  verifyReadToken(token: string): ReadClaims {
    const p = verify(token, "r");
    return { key: p.k, expiresAt: new Date(p.e * 1000), ...(typeof p.d === "string" ? { downloadAs: p.d } : {}) };
  }

  // Via a `.part` file and rename, so a dropped connection can't leave a truncated object.
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

  async discardObject(key: string): Promise<void> {
    assertSafeKey(key);
    await fsp.rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string) {
    const resolved = path.resolve(OBJECTS_DIR, key);
    // Defence in depth: catches traversal if assertSafeKey's regex is ever loosened.
    if (resolved !== OBJECTS_DIR && !resolved.startsWith(`${OBJECTS_DIR}${path.sep}`)) {
      throw new StorageKeyError("Storage key escapes the object root");
    }
    return resolved;
  }
}
