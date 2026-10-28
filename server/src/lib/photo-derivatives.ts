import exifReader from "exif-reader";
import sharp, { type Metadata, type OutputInfo, type Sharp } from "sharp";
import { paletteFromPixels, type Palette } from "./palette.js";
import type { PhotoDerivativeKind } from "../storage/index.js";

/**
 * Rendering a photo's derivatives (A6): the pixels behind `media.derive` and
 * `memory.refresh`, with no database or storage in sight.
 *
 * sharp (libvips) does the work. Its prebuilt libvips reads HEIF containers
 * but has no HEVC decoder (patents), so an iPhone HEIC's metadata reads fine
 * and its pixels don't; those are decoded by libheif compiled to WebAssembly
 * (`heic-decode` → `libheif-js`, which bundles libde265) and handed to sharp
 * as raw RGBA. See docs/PLAN.md, A6 "As built".
 */

// libvips' operation cache trades memory for speed on repeated work; every
// photo here is new, and the API shares a 1 GB machine with this worker.
sharp.cache(false);

/** Long edge of each rendition, in pixels. Never enlarged past the original. */
export const DERIVATIVE_LONG_EDGE: Record<PhotoDerivativeKind, number> = {
  THUMB: 400,
  DISPLAY: 1600,
};

/**
 * Past this the photo isn't read at all (it's held in memory to decode). A
 * 48 MP iPhone ProRAW-as-HEIC is ~25 MB; this leaves room for scans.
 */
export const MAX_DERIVE_BYTES = 150 * 1024 * 1024;

/** The bytes can't be read as a picture. Retrying won't change that. */
export class UndecodableImageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UndecodableImageError";
  }
}

export type Rendition = { kind: PhotoDerivativeKind; body: Buffer; width: number; height: number };

export type RenderedPhoto = {
  /** THUMB and DISPLAY, sRGB JPEGs with no metadata (no GPS leaves in a rendition). */
  renditions: Rendition[];
  /** The original's size as it's meant to be seen, i.e. after EXIF/HEIF rotation. */
  width: number;
  height: number;
  /** EXIF DateTimeOriginal (else DateTimeDigitized) as that calendar day at 12:00 UTC. */
  capturedAt: Date | null;
};

/** Decode once, render both sizes. Throws `UndecodableImageError` for bytes that aren't a picture. */
export async function renderPhoto(original: Buffer): Promise<RenderedPhoto> {
  let meta: Metadata;
  try {
    meta = await sharp(original).metadata();
  } catch (err) {
    throw new UndecodableImageError(`Not a readable image: ${errorText(err)}`, { cause: err });
  }

  const { image, width, height } = await decoded(original, meta);

  let display: { data: Buffer; info: OutputInfo };
  try {
    display = await toJpeg(image, DERIVATIVE_LONG_EDGE.DISPLAY, 82);
  } catch (err) {
    throw new UndecodableImageError(`Couldn't decode the image: ${errorText(err)}`, { cause: err });
  }
  // From the DISPLAY rendering rather than the original: a 1600 px JPEG
  // decodes in a few ms, and a 400 px thumbnail can't tell the difference.
  const thumb = await toJpeg(sharp(display.data), DERIVATIVE_LONG_EDGE.THUMB, 80);

  return {
    renditions: [
      { kind: "THUMB", body: thumb.data, width: thumb.info.width, height: thumb.info.height },
      { kind: "DISPLAY", body: display.data, width: display.info.width, height: display.info.height },
    ],
    width,
    height,
    capturedAt: exifCaptureDay(meta.exif),
  };
}

/**
 * A sharp pipeline over the original's pixels, upright. Everything sharp can
 * decode itself goes straight through (`autoOrient` applies the EXIF
 * rotation). HEVC-coded HEIF goes through libheif-wasm, which applies the
 * HEIF rotation/mirror boxes itself — HEIF's EXIF orientation is
 * informational only and must not be applied again.
 */
async function decoded(original: Buffer, meta: Metadata): Promise<{ image: Sharp; width: number; height: number }> {
  if (meta.format === "heif" && meta.compression === "hevc") {
    // Loaded on first use: the WASM module (≈2 MB, plus its heap) stays out
    // of any process that never sees a HEIC.
    const { default: decodeHeic } = await import("heic-decode");
    let out: Awaited<ReturnType<typeof decodeHeic>>;
    try {
      out = await decodeHeic({ buffer: original });
    } catch (err) {
      throw new UndecodableImageError(`Couldn't decode the HEIC: ${errorText(err)}`, { cause: err });
    }
    const pixels = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength);
    return {
      image: sharp(pixels, { raw: { width: out.width, height: out.height, channels: 4 } }),
      width: out.width,
      height: out.height,
    };
  }
  // `failOn: "error"`: a JPEG with a harmless warning (a short trailer, an odd
  // marker — common from older cameras and scanners) still renders.
  const upright = meta.autoOrient ?? { width: meta.width ?? 0, height: meta.height ?? 0 };
  return { image: sharp(original, { failOn: "error" }).autoOrient(), width: upright.width, height: upright.height };
}

/**
 * Fit inside a `longEdge` square, never enlarged; transparency over white
 * (JPEG has none); converted to sRGB with all metadata dropped — sharp's
 * default — so a rendition carries no location.
 */
function toJpeg(image: Sharp, longEdge: number, quality: number) {
  return image
    .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
}

/**
 * When the picture was taken, by the camera's own clock. EXIF stores local
 * wall-clock time with no zone (OffsetTimeOriginal is newer and often
 * missing), and memories are dated by day, so this keeps the camera's
 * calendar day and pins it at noon UTC: the same day for anyone within ±11 h
 * of UTC, like the compose screen's local-noon dates. `exif-reader` parses
 * the wall-clock text as if it were UTC, so the UTC fields are that day.
 *
 * Image.DateTime is deliberately not used: editing software rewrites it.
 */
export function exifCaptureDay(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  let taken: Date | undefined;
  try {
    const tags = exifReader(exif);
    taken = tags.Photo?.DateTimeOriginal ?? tags.Photo?.DateTimeDigitized;
  } catch {
    return null; // a mangled EXIF block costs us the date, not the derivatives
  }
  if (!(taken instanceof Date) || Number.isNaN(taken.getTime())) return null;
  const day = new Date(Date.UTC(taken.getUTCFullYear(), taken.getUTCMonth(), taken.getUTCDate(), 12));
  // Cameras with an unset clock write 1970, 2000 or 0000; none of those is a memory's date.
  if (day.getUTCFullYear() < 1900 || day.getTime() > Date.now() + 24 * 3600 * 1000) return null;
  if (day.getUTCFullYear() === 1970 && day.getUTCMonth() === 0 && day.getUTCDate() === 1) return null;
  return day;
}

/** How many pixels the palette reads: plenty for five colours, quick to cluster. */
const PALETTE_EDGE = 64;

/** The palette of a rendition (a THUMB, in practice). */
export async function paletteOf(rendition: Buffer): Promise<Palette> {
  const { data, info } = await sharp(rendition)
    .resize(PALETTE_EDGE, PALETTE_EDGE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return paletteFromPixels(data, info.channels);
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
