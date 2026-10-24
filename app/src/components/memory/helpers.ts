/** A story split into paragraphs on blank lines, each with a stable key. */
export function paragraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({ key: `${i}:${p.slice(0, 24)}`, text: p }));
}

/**
 * `count` bar heights in 0.12..1 that look like speech — bursts and pauses —
 * from a PRNG seeded with `seed`, so a clip's shape never changes between
 * renders. A stand-in until there's real waveform data.
 */
export function pseudoWaveform(seed: string, count: number) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  // mulberry32
  const random = () => {
    h += 0x6d2b79f5;
    h |= 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const phase = random() * Math.PI * 2;
  const rate = 0.18 + random() * 0.2;
  const bars: { key: string; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    // A slow swell (phrases) times a fast jitter (syllables).
    const swell = 0.35 + 0.65 * Math.abs(Math.sin(i * rate + phase));
    const jitter = 0.3 + 0.7 * random();
    bars.push({ key: `${seed}-${i}`, height: Math.min(1, Math.max(0.12, swell * jitter)) });
  }
  return bars;
}
