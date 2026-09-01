import zlib from "node:zlib";

/**
 * Deterministic placeholder image generator.
 *
 * The seeded archive has no real photographs in it, and we don't want the app
 * reaching out to a third-party image host just to look alive. So every "photo"
 * is a gradient rendered here from a string seed, mixed only from the five
 * brand colours: same seed, same image,
 * forever, and it works with no network at all. Swap this for real media
 * storage (S3/R2 + a CDN) when uploads become the primary path.
 */

const PALETTES: Array<[string, string]> = [
  ["#E9EBE3", "#A3AA9A"], // sage
  ["#D3D8CB", "#78826E"], // sage, deep
  ["#E4EAEB", "#8FA1A6"], // dusk blue
  ["#CBD6D8", "#63767C"], // dusk blue, deep
  ["#F7E8CE", "#D49A4A"], // golden honey
  ["#EFD6A9", "#A97535"], // golden honey, deep
  ["#F8E3DA", "#D68A75"], // terracotta
  ["#EFCDC0", "#AF6350"], // terracotta, deep
  ["#DDE0DA", "#5A6458"], // forest, lifted
  ["#B9C0B5", "#2F362E"], // forest
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

/** `#RRGGBB` only — anything else is ignored rather than half-parsed. */
const HEX = /^#[0-9a-fA-F]{6}$/;

// Everything that shapes the render. Named so RENDER_VERSION can fingerprint
// them — see the note there before changing any of these.
const BLOOM = 0.28;
const VIGNETTE = 0.22;
/** A pinned colour gets a gentler treatment; see `placeholderPng`. */
const PINNED_BLOOM = 0.1;
const PINNED_VIGNETTE = 0.12;
const PINNED_LIGHT = 0.16;
const PINNED_DARK = -0.2;

/**
 * A fingerprint of everything above that affects the output.
 *
 * These images are served `immutable` for a year, which is right — a given URL
 * really does render the same bytes forever. But the palette is ours to change,
 * and when it does, every client would happily keep the old colours until the
 * cache expired. So the fingerprint rides along in the URL: change a swatch and
 * every generated-media URL changes with it. Nothing to remember to bump.
 */
export const RENDER_VERSION = hash(
  JSON.stringify([PALETTES, BLOOM, VIGNETTE, PINNED_BLOOM, PINNED_VIGNETTE, PINNED_LIGHT, PINNED_DARK]),
)
  .toString(36)
  .slice(0, 6);

/** Mix toward white (t > 0) or black (t < 0). */
function shade(rgb: [number, number, number], t: number): [number, number, number] {
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return rgb.map((v) => v + (target - v) * k) as [number, number, number];
}

/**
 * The two ends of the gradient.
 *
 * Given a base colour the ramp is built around it — a light tint into a slightly
 * deepened version — so the result reads unmistakably as that one colour. This
 * is what avatars use, passing the person's own palette colour, so an orb and
 * the ring around it are the same hue. Without one, the seed picks a brand pair,
 * which is what stand-in photography wants: varied, but still on-palette.
 */
function ramp(seed: string, baseHex?: string | null) {
  if (baseHex && HEX.test(baseHex)) {
    const base = hexToRgb(baseHex);
    // Centred on the base and biased slightly dark, so what's left of the
    // bloom lands the midtone back on the colour itself.
    return { light: shade(base, PINNED_LIGHT), dark: shade(base, PINNED_DARK) };
  }
  const [lightHex, darkHex] = PALETTES[hash(seed) % PALETTES.length];
  return { light: hexToRgb(lightHex), dark: hexToRgb(darkHex) };
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

/**
 * A soft diagonal gradient with a light bloom, rendered from `seed`.
 *
 * `baseHex` pins the gradient to one colour — see `ramp`.
 */
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
  // Stand-in photography wants the bloom: it's what stops a grid of gradients
  // reading as flat swatches. A pinned colour wants the opposite — the point is
  // to be recognisably that colour, and a strong bloom washes it out.
  const bloomAmt = pinned ? PINNED_BLOOM : BLOOM;
  const vignetteAmt = pinned ? PINNED_VIGNETTE : VIGNETTE;
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
      const bloom = Math.max(0, 1 - Math.hypot(nx - bx, ny - by) * 2.1) * bloomAmt;
      const vignette = Math.hypot(nx - 0.5, ny - 0.5) * vignetteAmt;
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
