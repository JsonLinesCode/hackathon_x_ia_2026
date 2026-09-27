import { resolveRelativeDate } from "./dates";
import { normalizeName } from "./trip-cities";

// Formats accepted from either extraction or inline input. Dates without a year
// use the next occurrence; numeric dates use day/month in both UI languages.
export function resolveDraftDate(text: string, now: Date, timezone: string): string {
  const value = normalizeName(text).replace(/^(?:le|on|the) /, "");
  const today = resolveRelativeDate("today", now, timezone);
  const [year, month, day] = today.split("-").map(Number);
  const months = ["janvier january", "fevrier february", "mars march", "avril april", "mai may", "juin june", "juillet july", "aout august", "septembre september", "octobre october", "novembre november", "decembre december"];
  const short = /^(?:le\s+|on\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(text.trim().toLowerCase());
  const named = /^(\d{1,2})(?:er|st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(value);
  const bare = /^(\d{1,2})(?:er|st|nd|rd|th)?$/.exec(value);
  let wantedDay: number, wantedMonth: number, wantedYear: number, explicitYear = false;
  if (short) {
    wantedDay = Number(short[1]); wantedMonth = Number(short[2]);
    explicitYear = Boolean(short[3]); wantedYear = short[3] ? Number(short[3]) + (short[3].length === 2 ? 2000 : 0) : year;
  } else if (named && months.some((names) => names.split(" ").includes(named[2]))) {
    wantedDay = Number(named[1]); wantedMonth = months.findIndex((names) => names.split(" ").includes(named[2])) + 1;
    explicitYear = Boolean(named[3]); wantedYear = Number(named[3] ?? year);
  } else if (bare) {
    wantedDay = Number(bare[1]); wantedMonth = month + (wantedDay < day ? 1 : 0); wantedYear = year;
    if (wantedMonth === 13) { wantedMonth = 1; wantedYear++; }
  } else return resolveRelativeDate(text.trim().toLowerCase().replace(/^le\s+/, ""), now, timezone);
  if (!explicitYear && !bare && (wantedMonth < month || wantedMonth === month && wantedDay < day)) wantedYear++;
  return resolveRelativeDate(`${wantedYear}-${String(wantedMonth).padStart(2, "0")}-${String(wantedDay).padStart(2, "0")}`, now, timezone);
}
export function normalizeDraftTime(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid time");
  const match = /^(\d{1,2})(?:\s*[:h]\s*(\d{1,2})?)?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) throw new Error("Invalid time");
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0), period = match[3]?.toLowerCase();
  if (period) { if (hour < 1 || hour > 12) throw new Error("Invalid time"); hour = hour % 12 + (period === "pm" ? 12 : 0); }
  if (hour > 23 || minute > 59) throw new Error("Invalid time");
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
export function addDraftMinutes(start: string, minutes: number) {
  const total = (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + minutes) % 1440;
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

// Literal clock limits are deterministic: preserve them even when extraction
// omits an otherwise usable optional filter. A date or bare vague phrase is not
// treated as a clock time.
export function explicitDraftTimeWindows(message: string): import("@repo/types").DraftChange[] {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const clock = "(\\d{1,2}(?:\\s*h(?:\\s*\\d{1,2})?|:\\d{2}|\\s*(?:am|pm)))";
  const pattern = new RegExp("\\b((?:ne\\s+)?pas(?:\\s+de)?\\s+|no\\s+)?(vols?|flights?|depart(?:s|ure)?|partir|decoller|leave|arriv(?:er|ee|al|e)|atterrir)\\s+(pas\\s+)?(avant|apres|before|after|from|by)\\s+" + clock + "\\b", "g");
  const windows = new Map<"departure_window" | "arrival_window", { earliest: string | null; latest: string | null }>();
  for (const match of text.matchAll(pattern)) {
    let time: string; try { time = normalizeDraftTime(match[5]); } catch { continue; }
    const field = /^(arriv|atterrir)/.test(match[2]) ? "arrival_window" : "departure_window";
    const before = ["avant", "before", "by"].includes(match[4]), negated = Boolean(match[1] || match[3]);
    const bound = before !== negated ? "latest" : "earliest";
    const window = windows.get(field) ?? { earliest: null, latest: null };
    window[bound] = time; windows.set(field, window);
  }
  return [...windows].map(([field, value]) => ({ field, value: { ...value, relative_to: "local_time" }, traveler_id: null }));
}
