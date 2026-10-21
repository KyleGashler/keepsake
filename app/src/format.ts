const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function longDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function shortDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Journal-style relative time for the Family Updates feed. */
export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(iso);
}

export function duration(seconds?: number | null) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A length limit in words: "2 minutes", "1 minute", "90 seconds". */
export function lengthInWords(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** Always-on m:ss for timers and scrubbers — "0:00" rather than nothing. */
export function clock(seconds: number) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "5 years old" / "2 years, 4 months" — used on person cards. */
export function ageFrom(birthIso?: string | null) {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  return `${years} years`;
}

/** "Age 5", "Age 8 months", "Newborn" — how a child's card and header read. */
export function childAge(birthIso?: string | null) {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 1) return "Newborn";
  if (months < 24) return `Age ${months} ${months === 1 ? "month" : "months"}`;
  return `Age ${Math.floor(months / 12)}`;
}

/** "Banks's" — copy names a child rather than guessing a pronoun. */
export function possessive(name: string) {
  return `${name}'s`;
}

/** "1 memory", "248 memories". */
export function count(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** What a caught error says, or `fallback` when what was thrown isn't an Error. */
export function errorMessage(err: unknown, fallback = "") {
  return err instanceof Error ? err.message : fallback;
}

const SEASONS = ["Winter", "Spring", "Summer", "Fall"] as const;

/**
 * "Summer 2026" — the season a date fell in, northern hemisphere, by
 * meteorological season (Dec–Feb winter, Mar–May spring, …). December belongs
 * to the winter of its own calendar year, so a date never reads as a year it
 * wasn't.
 */
export function seasonOf(iso: string) {
  const d = new Date(iso);
  return `${SEASONS[Math.floor(((d.getMonth() + 1) % 12) / 3)]} ${d.getFullYear()}`;
}

/** "2026-08-18" — the local calendar day, as `<input type="date">` and the date fields use it. */
export function isoDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * `iso` moved to the calendar day `day` ("YYYY-MM-DD", local time), keeping
 * its time of day. Null if `day` isn't a real date.
 */
export function withDay(iso: string, day: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(iso);
  d.setFullYear(y, mo, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
  return d.toISOString();
}
