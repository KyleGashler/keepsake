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

/** "Sep 2" — a date under a year heading, where the year is already said. */
export function monthDay(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

/**
 * How old a child was on a given day: "age 4", "18 months", "newborn". Null
 * without a birthday, or for a day before it.
 */
export function ageOn(birthIso: string | null | undefined, atIso: string) {
  if (!birthIso) return null;
  const birth = new Date(birthIso);
  const at = new Date(atIso);
  let months = (at.getFullYear() - birth.getFullYear()) * 12 + (at.getMonth() - birth.getMonth());
  if (at.getDate() < birth.getDate()) months -= 1;
  if (months < 0) return null;
  if (months < 1) return "newborn";
  if (months < 24) return `${months} ${months === 1 ? "month" : "months"}`;
  return `age ${Math.floor(months / 12)}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Birthdays are calendar dates the server stores as UTC midnight, so they're
 * read and written in UTC — a local reading puts a birthday a day early
 * anywhere west of Greenwich.
 */
export function birthdayInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * "2020-05-14" → the ISO the API takes; "" → null (no birthday); anything
 * that isn't a real date between 1900 and today → undefined (invalid).
 */
export function parseBirthday(input: string): string | null | undefined {
  const text = input.trim();
  if (!text) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined;
  if (y < 1900 || date.getTime() > Date.now()) return undefined;
  return date.toISOString();
}

/** "May 14, 2020" from a stored birthday, read in UTC (see birthdayInput). */
export function birthdayLabel(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Age 6", "7 Collections", "248 Memories" — a child's header line, in parts. */
export function childMeta(child: { birthDate: string | null; collectionCount: number; memoryCount: number }) {
  return [
    childAge(child.birthDate),
    count(child.collectionCount, "Collection"),
    count(child.memoryCount, "Memory", "Memories"),
  ].filter((part): part is string => Boolean(part));
}

/**
 * What went wrong, in words a family can read. The API answers errors with
 * JSON (`{ error: "…" }`, or a validation dump); upload failures already
 * arrive as sentences.
 */
export function friendlyError(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : "";
  if (!message) return fallback;
  if (message.trimStart().startsWith("{")) {
    try {
      const body: unknown = JSON.parse(message);
      if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
        return body.error;
      }
    } catch {
      // Not JSON after all.
    }
    return fallback;
  }
  return /failed to fetch|network/i.test(message) ? "Can't reach the archive right now." : message;
}
