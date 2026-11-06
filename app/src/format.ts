import { ApiError } from "./api";

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

export function lengthInWords(seconds: number) {
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function clock(seconds: number) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function monthsOld(birthIso: string, at: Date) {
  const birth = new Date(birthIso);
  const months = (at.getFullYear() - birth.getFullYear()) * 12 + (at.getMonth() - birth.getMonth());
  return at.getDate() < birth.getDate() ? months - 1 : months;
}

export function yearsOld(birthIso: string | null | undefined) {
  return birthIso ? Math.floor(monthsOld(birthIso, new Date()) / 12) : 0;
}

export function ageFrom(birthIso?: string | null) {
  if (!birthIso) return null;
  const months = monthsOld(birthIso, new Date());
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  return `${years} years`;
}

export function childAge(birthIso?: string | null) {
  if (!birthIso) return null;
  const months = monthsOld(birthIso, new Date());
  if (months < 1) return "Newborn";
  if (months < 24) return `Age ${months} ${months === 1 ? "month" : "months"}`;
  return `Age ${Math.floor(months / 12)}`;
}

export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

export function collectionName(c: { name: string; parentName: string | null }) {
  return c.parentName ? `${c.parentName} · ${c.name}` : c.name;
}

export function deleteCollectionMessage(memoryCount: number) {
  if (memoryCount === 0) return "It's empty, so nothing else changes.";
  const memories =
    memoryCount === 1
      ? "The memory in it stays in the archive, and in any other collection it's filed in."
      : `The ${memoryCount} memories in it stay in the archive, and in any other collection they're filed in.`;
  return `${memories} Only this collection goes.`;
}

export function possessive(name: string) {
  return `${name}'s`;
}

export function count(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function errorMessage(err: unknown, fallback = "") {
  return err instanceof Error ? err.message : fallback;
}

export function monthDay(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

export function ageOn(birthIso: string | null | undefined, atIso: string) {
  if (!birthIso) return null;
  const months = monthsOld(birthIso, new Date(atIso));
  if (months < 0) return null;
  if (months < 1) return "newborn";
  if (months < 24) return `${months} ${months === 1 ? "month" : "months"}`;
  return `age ${Math.floor(months / 12)}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// Birthdays are stored as UTC midnight, so read and write them in UTC: local time puts them a day early
// west of Greenwich.
export function birthdayInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

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

export function birthdayLabel(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function childMeta(child: { birthDate: string | null; collectionCount: number; memoryCount: number }) {
  return [
    childAge(child.birthDate),
    count(child.collectionCount, "Collection"),
    count(child.memoryCount, "Memory", "Memories"),
  ].filter((part): part is string => Boolean(part));
}

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

const REFUSALS: Record<string, string> = {
  person_is_member: "They have an account in this family. An owner can remove them in Family Hub first.",
  order_mismatch: "Something changed while you were arranging. Close this and try again.",
};

export function refusalMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.code && REFUSALS[err.code]) return REFUSALS[err.code];
  return friendlyError(err, fallback);
}

export function nameList(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function isoDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function withDay(iso: string, day: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const d = new Date(iso);
  d.setFullYear(y, mo, da);
  if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
  return d.toISOString();
}
