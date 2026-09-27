import { TimeZoneSchema } from "@repo/types";

function localDate(date: Date, timeZone: string) {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid reference date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}
function shiftDate(date: string, days: number) {
  const instant = new Date(date + "T12:00:00Z");
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}
const weekdays: Record<string, number> = {
  sunday: 0, dimanche: 0, monday: 1, lundi: 1, tuesday: 2, mardi: 2,
  wednesday: 3, mercredi: 3, thursday: 4, jeudi: 4, friday: 5, vendredi: 5, saturday: 6, samedi: 6,
};

// Returns a local calendar date. "Next Tuesday"/"mardi prochain" means the next
// occurrence strictly after today; a bare weekday may resolve to today.
export function resolveRelativeDate(text: string, now = new Date(), timeZone = "Europe/Paris"): string {
  TimeZoneSchema.parse(timeZone);
  const today = localDate(now, timeZone);
  const value = text.trim().toLowerCase().replaceAll("’", "'");
  if (["today", "aujourd'hui"].includes(value)) return today;
  if (["tomorrow", "demain"].includes(value)) return shiftDate(today, 1);
  if (["day after tomorrow", "après-demain", "apres-demain"].includes(value)) return shiftDate(today, 2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const instant = new Date(value + "T12:00:00Z");
    if (Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value) return value;
    throw new Error("Invalid calendar date");
  }
  const relative = /^(?:in (\d+) days?|dans (\d+) jours?)$/.exec(value);
  if (relative) {
    const days = Number(relative[1] ?? relative[2]);
    if (days <= 3650) return shiftDate(today, days);
  }
  const weekday = /^(next )?([a-zé]+)( prochain)?$/.exec(value);
  if (weekday && Object.hasOwn(weekdays, weekday[2])) {
    const day = new Date(today + "T12:00:00Z").getUTCDay();
    let offset = (weekdays[weekday[2]] - day + 7) % 7;
    if (offset === 0 && (weekday[1] || weekday[3])) offset = 7;
    return shiftDate(today, offset);
  }
  throw new Error("Date is ambiguous or unsupported. Supply an explicit date.");
}

// Reject nonexistent and ambiguous wall times around DST rather than guessing.
export function zonedDateTimeToUtc(date: string, time: string, timeZone = "Europe/Paris", disambiguation: "reject" | "compatible" = "reject"): string {
  TimeZoneSchema.parse(timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Use YYYY-MM-DD and HH:mm");
  }
  resolveRelativeDate(date, new Date(), timeZone);
  const target = Date.parse(date + "T" + time + ":00Z");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const matches: string[] = [];
  const afterGap: { wall: number; instant: string }[] = [];
  // Includes quarter-hour offsets and both sides of daylight-saving transitions.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(target - offset * 60000);
    const parts = formatter.formatToParts(candidate);
    const get = (type: string) => parts.find((part) => part.type === type)!.value;
    const wall = Date.parse(get("year") + "-" + get("month") + "-" + get("day") + "T" + get("hour") + ":" + get("minute") + ":00Z");
    if (wall > target && wall <= target + 3600000) afterGap.push({ wall, instant: candidate.toISOString() });
    if (get("year") + "-" + get("month") + "-" + get("day") === date && get("hour") + ":" + get("minute") === time) {
      matches.push(candidate.toISOString());
    }
  }
  if (disambiguation === "compatible") {
    if (matches.length) return matches.sort()[0];
    if (afterGap.length) return afterGap.sort((a, b) => b.wall - a.wall)[0].instant;
  }
  if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous local time; specify an offset." : "This local time does not exist.");
  return matches[0];
}
