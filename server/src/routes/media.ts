import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { placeholderPng } from "../lib/placeholder.js";

export const mediaRouter = Router();

export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.resolve("media");
const UPLOAD_DIR = path.join(MEDIA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Generated stand-in imagery — see lib/placeholder.ts for why these exist. */
mediaRouter.get("/gen/:seed.png", (req, res) => {
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

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || guessExt(file.mimetype);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype)),
});

function guessExt(mime: string) {
  if (mime.startsWith("image/")) return `.${mime.split("/")[1]}`;
  if (mime.startsWith("video/")) return ".mp4";
  if (mime.startsWith("audio/")) return ".m4a";
  return "";
}

function mediaType(mime: string): "PHOTO" | "VIDEO" | "AUDIO" {
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "PHOTO";
}

/**
 * Originals land on a local volume in this build. Original media is sacred —
 * whatever storage replaces this must keep the untouched file forever.
 */
mediaRouter.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file accepted (unsupported type or missing field 'file')" });
  res.status(201).json({
    media: {
      url: `/media/uploads/${req.file.filename}`,
      type: mediaType(req.file.mimetype),
      bytes: req.file.size,
      originalName: req.file.originalname,
    },
  });
});
