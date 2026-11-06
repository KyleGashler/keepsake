import exifReader from "exif-reader";
import sharp, { type Metadata, type OutputInfo, type Sharp } from "sharp";
import { paletteFromPixels, type Palette } from "./palette.js";
import type { PhotoDerivativeKind } from "../storage/index.js";

// Every photo is new, so libvips' operation cache only costs memory on a shared 1 GB machine.
sharp.cache(false);

export const DERIVATIVE_LONG_EDGE: Record<PhotoDerivativeKind, number> = {
  THUMB: 400,
  DISPLAY: 1600,
};

export const MAX_DERIVE_BYTES = 150 * 1024 * 1024;

export class UndecodableImageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UndecodableImageError";
  }
}

export type Rendition = { kind: PhotoDerivativeKind; body: Buffer; width: number; height: number };

export type RenderedPhoto = {
  renditions: Rendition[];
  width: number;
  height: number;
  capturedAt: Date | null;
};

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

async function decoded(original: Buffer, meta: Metadata): Promise<{ image: Sharp; width: number; height: number }> {
  // sharp's prebuilt libvips has no HEVC decoder. libheif applies HEIF's rotation boxes itself;
  // HEIF's EXIF orientation is informational and must not be applied again.
  if (meta.format === "heif" && meta.compression === "hevc") {
    // Lazy: the WASM module (≈2 MB plus heap) stays out of processes that never see a HEIC.
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
  // `failOn: "error"` so JPEGs with harmless warnings (common from older cameras and scanners) still render.
  const upright = meta.autoOrient ?? { width: meta.width ?? 0, height: meta.height ?? 0 };
  return { image: sharp(original, { failOn: "error" }).autoOrient(), width: upright.width, height: upright.height };
}

// sharp drops all metadata by default, so a rendition carries no location.
function toJpeg(image: Sharp, longEdge: number, quality: number) {
  return image
    .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
}

// EXIF stores zoneless wall-clock time, which `exif-reader` parses as UTC, so the UTC fields are the camera's day.
// Image.DateTime is skipped: editing software rewrites it.
export function exifCaptureDay(exif: Buffer | undefined): Date | null {
  if (!exif) return null;
  let taken: Date | undefined;
  try {
    const tags = exifReader(exif);
    taken = tags.Photo?.DateTimeOriginal ?? tags.Photo?.DateTimeDigitized;
  } catch {
    return null;
  }
  if (!(taken instanceof Date) || Number.isNaN(taken.getTime())) return null;
  const day = new Date(Date.UTC(taken.getUTCFullYear(), taken.getUTCMonth(), taken.getUTCDate(), 12));
  // Cameras with an unset clock write 1970, 2000 or 0000; none of those is a memory's date.
  if (day.getUTCFullYear() < 1900 || day.getTime() > Date.now() + 24 * 3600 * 1000) return null;
  if (day.getUTCFullYear() === 1970 && day.getUTCMonth() === 0 && day.getUTCDate() === 1) return null;
  return day;
}

const PALETTE_EDGE = 64;

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
