import zlib from "node:zlib";

/**
 * Deterministic placeholder image generator.
 *
 * The seeded archive has no real photographs in it, and we don't want the app
 * reaching out to a third-party image host just to look alive. So every "photo"
 * is a warm gradient rendered here from a string seed: same seed, same image,
 * forever, and it works with no network at all. Swap this for real media
 * storage (S3/R2 + a CDN) when uploads become the primary path.
 */

const PALETTES: Array<[string, string]> = [
  ["#F4C7A1", "#B4623C"], // late afternoon
  ["#E8D5C4", "#8A6A55"], // linen
  ["#F6D9C0", "#C97B5A"], // terracotta
  ["#DCE3D5", "#6F8267"], // sage
  ["#E6DCEB", "#7A6A8F"], // dusk
  ["#FBE6D4", "#D99C6A"], // honey
  ["#D7E1E9", "#5F7A8C"], // harbor
  ["#F2D7D9", "#A8646E"], // rose
  ["#EFE7D2", "#9C8A5F"], // wheat
  ["#D9E4E1", "#557069"], // spruce
];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Stable 0-360 hue for a seed, so Mosaic can sort tiles by "palette". */
export function hueForSeed(seed: string): number {
  const [a, b] = PALETTES[hash(seed) % PALETTES.length];
  const [r, g, bl] = hexToRgb(b);
  const max = Math.max(r, g, bl);
  const min = Math.min(r, g, bl);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - bl) / d) % 6;
  else if (max === g) h = (bl - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (width * 3 + 1);
    raw[dst] = 0; // filter: none
    rgb.copy(raw, dst + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const cache = new Map<string, Buffer>();
const CACHE_LIMIT = 200;

/** A soft diagonal gradient with a light bloom, rendered from `seed`. */
export function placeholderPng(seed: string, width: number, height: number): Buffer {
  const key = `${seed}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const h = hash(seed);
  const [lightHex, darkHex] = PALETTES[h % PALETTES.length];
  const light = hexToRgb(lightHex);
  const dark = hexToRgb(darkHex);
  // Rotate the gradient and move the bloom around based on the seed so a wall
  // of tiles doesn't read as one repeated image.
  const angle = ((h >>> 8) % 360) * (Math.PI / 180);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const bx = 0.25 + (((h >>> 16) % 100) / 100) * 0.5;
  const by = 0.2 + (((h >>> 20) % 100) / 100) * 0.5;

  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      // Project onto the gradient axis, normalised to 0..1.
      let t = (nx - 0.5) * dx + (ny - 0.5) * dy + 0.5;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      // Ease so the midpoint doesn't look like a hard band.
      t = t * t * (3 - 2 * t);
      const bloom = Math.max(0, 1 - Math.hypot(nx - bx, ny - by) * 2.1) * 0.28;
      const vignette = Math.hypot(nx - 0.5, ny - 0.5) * 0.22;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        let v = light[c] + (dark[c] - light[c]) * t;
        v = v + (255 - v) * bloom - v * vignette;
        rgb[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  const png = encodePng(width, height, rgb);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, png);
  return png;
}
