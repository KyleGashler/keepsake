import zlib from "node:zlib";

const PALETTES: [string, string][] = [
  ["#E9EBE3", "#A3AA9A"],
  ["#D3D8CB", "#78826E"],
  ["#E4EAEB", "#8FA1A6"],
  ["#CBD6D8", "#63767C"],
  ["#F7E8CE", "#D49A4A"],
  ["#EFD6A9", "#A97535"],
  ["#F8E3DA", "#D68A75"],
  ["#EFCDC0", "#AF6350"],
  ["#DDE0DA", "#5A6458"],
  ["#B9C0B5", "#2F362E"],
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

const HEX = /^#[0-9a-fA-F]{6}$/;

// Every render constant must be listed in RENDER_VERSION.
const BLOOM = 0.28;
const VIGNETTE = 0.22;
const PINNED_BLOOM = 0.1;
const PINNED_VIGNETTE = 0.12;
const PINNED_LIGHT = 0.16;
const PINNED_DARK = -0.2;

// Generated media is served `immutable`, so this fingerprint in the URL is
// what makes clients refetch after a palette change.
export const RENDER_VERSION = hash(
  JSON.stringify([PALETTES, BLOOM, VIGNETTE, PINNED_BLOOM, PINNED_VIGNETTE, PINNED_LIGHT, PINNED_DARK]),
)
  .toString(36)
  .slice(0, 6);

function shade(rgb: [number, number, number], t: number): [number, number, number] {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const mix = (v: number) => v + (target - v) * k;
  return [mix(rgb[0]), mix(rgb[1]), mix(rgb[2])];
}

function ramp(seed: string, baseHex?: string | null) {
  if (baseHex && HEX.test(baseHex)) {
    const base = hexToRgb(baseHex);
    return { light: shade(base, PINNED_LIGHT), dark: shade(base, PINNED_DARK) };
  }
  const [lightHex, darkHex] = PALETTES[hash(seed) % PALETTES.length];
  return { light: hexToRgb(lightHex), dark: hexToRgb(darkHex) };
}

export function hueForSeed(seed: string): number {
  const [, b] = PALETTES[hash(seed) % PALETTES.length];
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
  for (const byte of buf) {
    c ^= byte;
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

export function placeholderPng(
  seed: string,
  width: number,
  height: number,
  baseHex?: string | null,
): Buffer {
  const key = `${seed}:${width}x${height}:${baseHex ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const h = hash(seed);
  const pinned = !!(baseHex && HEX.test(baseHex));
  const { light, dark } = ramp(seed, baseHex);
  const bloomAmt = pinned ? PINNED_BLOOM : BLOOM;
  const vignetteAmt = pinned ? PINNED_VIGNETTE : VIGNETTE;
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
      let t = (nx - 0.5) * dx + (ny - 0.5) * dy + 0.5;
      t = Math.min(1, Math.max(0, t));
      t = t * t * (3 - 2 * t);
      const bloom = Math.max(0, 1 - Math.hypot(nx - bx, ny - by) * 2.1) * bloomAmt;
      const vignette = Math.hypot(nx - 0.5, ny - 0.5) * vignetteAmt;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        let v = light[c] + (dark[c] - light[c]) * t;
        v = v + (255 - v) * bloom - v * vignette;
        rgb[i + c] = Math.min(255, Math.max(0, v));
      }
    }
  }

  const png = encodePng(width, height, rgb);
  const oldest = cache.keys().next();
  if (cache.size >= CACHE_LIMIT && !oldest.done) cache.delete(oldest.value);
  cache.set(key, png);
  return png;
}
