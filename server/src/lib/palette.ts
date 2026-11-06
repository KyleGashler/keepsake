// k-means in CIE Lab, where distance is roughly what an eye sees. `hue` is HSV, the same
// measure `hueForSeed` gives the generated stand-ins, so the two sort together.

export type Palette = { swatches: string[]; hue: number; brightness: number };

type Rgb = [number, number, number];
type Lab = [number, number, number];

const K = 5;
const ITERATIONS = 12;

// Lab chroma (roughly 0-130) below which a colour reads as grey.
export const NEUTRAL_CHROMA = 12;

// `channels` is 3 or 4 bytes per pixel; alpha is ignored.
export function paletteFromPixels(pixels: Uint8Array, channels: number): Palette {
  const n = Math.floor(pixels.length / channels);
  if (n === 0) throw new RangeError("No pixels to read a palette from");

  const rgb = new Uint8Array(n * 3);
  const lab = new Float64Array(n * 3);
  let lightness = 0;
  for (let i = 0; i < n; i++) {
    const p: Rgb = [pixels[i * channels], pixels[i * channels + 1], pixels[i * channels + 2]];
    const l = rgbToLab(p);
    rgb.set(p, i * 3);
    lab.set(l, i * 3);
    lightness += l[0];
  }

  const assignment = kMeans(lab, n, Math.min(K, n));

  const groups = new Map<number, { count: number; lab: Lab; rgb: Rgb }>();
  for (let i = 0; i < n; i++) {
    const g = groups.get(assignment[i]) ?? { count: 0, lab: [0, 0, 0], rgb: [0, 0, 0] };
    g.count++;
    for (let c = 0; c < 3; c++) {
      g.lab[c] += lab[i * 3 + c];
      g.rgb[c] += rgb[i * 3 + c];
    }
    groups.set(assignment[i], g);
  }
  // A big flat area (sky, a wall) often splits into look-alike groups; fold them so the swatches differ.
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; ES2022 has no toSorted
  const bySize = [...groups.values()].sort((a, b) => b.count - a.count);
  const merged: typeof bySize = [];
  for (const g of bySize) {
    const twin = merged.find((m) => distance(mean(m.lab, m.count), mean(g.lab, g.count)) < SAME_COLOUR);
    if (!twin) {
      merged.push(g);
      continue;
    }
    twin.count += g.count;
    for (let c = 0; c < 3; c++) {
      twin.lab[c] += g.lab[c];
      twin.rgb[c] += g.rgb[c];
    }
  }
  const ranked = merged
    .map((g) => ({
      count: g.count,
      lab: mean(g.lab, g.count),
      rgb: scale(g.rgb, (v) => Math.round(v / g.count)),
    }))
    // oxlint-disable-next-line unicorn/no-array-sort -- a fresh array; ES2022 has no toSorted
    .sort((a, b) => b.count - a.count || a.lab[0] - b.lab[0]);

  // Big and colourful beats big and grey: a beach under a white sky files under its blue water.
  const telling = ranked.reduce((best, g) => (score(g) > score(best) ? g : best), ranked[0]);

  return {
    swatches: ranked.map((g) => toHex(g.rgb)),
    hue: hsvHue(telling.rgb),
    brightness: Math.round(lightness / n),
  };
}

// ΔE (CIE76); a just-noticeable difference is ~2.3.
const SAME_COLOUR = 10;

function scale(t: [number, number, number], f: (v: number) => number): [number, number, number] {
  return [f(t[0]), f(t[1]), f(t[2])];
}

function mean(sum: Lab, count: number): Lab {
  return scale(sum, (v) => v / count);
}

function distance(a: Lab, b: Lab) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function score(g: { count: number; lab: Lab }) {
  const c = chroma(g.lab);
  return g.count * (c / (c + 15));
}

export function isNeutralPalette(swatches: string[]) {
  const rgbs = swatches.map(fromHex).filter((x): x is Rgb => x !== null);
  return rgbs.length > 0 && rgbs.every((c) => chroma(rgbToLab(c)) < NEUTRAL_CHROMA);
}

// Seeded deterministically (lightness-sorted runs) so a re-run gives the same palette.
function kMeans(lab: Float64Array, n: number, k: number): Int32Array {
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => lab[a * 3] - lab[b * 3] || a - b);
  const centres = new Float64Array(k * 3);
  for (let j = 0; j < k; j++) {
    const from = Math.floor((j * n) / k);
    const to = Math.max(from + 1, Math.floor(((j + 1) * n) / k));
    for (let t = from; t < to; t++) for (let c = 0; c < 3; c++) centres[j * 3 + c] += lab[order[t] * 3 + c];
    for (let c = 0; c < 3; c++) centres[j * 3 + c] /= to - from;
  }

  const assignment = new Int32Array(n);
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < k; j++) {
        const d =
          (lab[i * 3] - centres[j * 3]) ** 2 +
          (lab[i * 3 + 1] - centres[j * 3 + 1]) ** 2 +
          (lab[i * 3 + 2] - centres[j * 3 + 2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (assignment[i] !== best || iter === 0) moved = true;
      assignment[i] = best;
    }
    if (!moved) break;
    const sums = new Float64Array(k * 3);
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const j = assignment[i];
      counts[j]++;
      for (let c = 0; c < 3; c++) sums[j * 3 + c] += lab[i * 3 + c];
    }
    for (let j = 0; j < k; j++) {
      if (counts[j] === 0) continue;
      for (let c = 0; c < 3; c++) centres[j * 3 + c] = sums[j * 3 + c] / counts[j];
    }
  }
  return assignment;
}

function chroma(lab: Lab) {
  return Math.hypot(lab[1], lab[2]);
}

function linear(v: number) {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function labF(t: number) {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
}

// sRGB (D65).
function rgbToLab([r8, g8, b8]: Rgb): Lab {
  const r = linear(r8);
  const g = linear(g8);
  const b = linear(b8);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function hsvHue([r, g, b]: Rgb) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360) % 360;
}

function toHex(rgb: Rgb) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): Rgb | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
