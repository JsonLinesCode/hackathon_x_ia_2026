import { z } from "zod";
import { DraftTimeWindowSchema, TripCardSchema, RelativeJourneySchema, JourneySchema, PlanningStateSchema, type DraftChange, type DraftIntent, type FieldSource, type JourneyMoment, type PolicyRules, type TravelerRecord, type TripCard } from "@repo/types";
import { zonedDateTimeToUtc } from "./dates";
import { addDraftMinutes, explicitDraftTimeWindows, normalizeDraftTime, resolveDraftDate } from "./draft-inputs";
import { normalizeName, tripCity } from "./trip-cities";

export class DraftError extends Error {}
const field = <T>(value: T, source: FieldSource, reference: string | null = null) => ({ value, source, reference });
function draftDate(text: string, now: Date, timezone: string) {
  try { return resolveDraftDate(text, now, timezone); }
  catch { throw new DraftError("The date is ambiguous. Use an explicit date in the card."); }
}
export const shiftDay = (date: string, days: number) => new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const changePriority = (name: DraftChange["field"]) => name === "destination" ? 0 : name === "meeting_date" ? 1 : name === "meeting_duration" ? 3 : ["outbound", "return", "hotel_nights"].includes(name) ? 4 : 2;
export const DRAFT_LABELS = {
  travelers: ["travelers", "les voyageurs"], destination: ["destination", "la destination"],
  meeting_date: ["meeting date", "la date de réunion"], meeting_start: ["meeting start", "l’heure de début"],
} as const;
export function requiredDraftFields(card: TripCard) {
  return (Object.keys(DRAFT_LABELS) as (keyof typeof DRAFT_LABELS)[]).filter((key) => key === "travelers" ? !card.travelers.value.length : !card[key].value);
}
// The only business gate shared by the card button and the validation route.
export function draftValidation(card: TripCard) {
  const missing = requiredDraftFields(card), fr = card.language === "fr";
  return { missing, canValidate: missing.length === 0, question: missing.length
    ? (fr ? "Pouvez-vous préciser " : "Please specify ") + missing.map((key) => DRAFT_LABELS[key][fr ? 1 : 0]).join(", ") + " ?"
    : "" };
}
export function detectedTravelers(text: string, directory: TravelerRecord[]) {
  const normalized = " " + normalizeName(text) + " ";
  return directory.filter((p) => {
    const name = normalizeName(p.full_name), first = name.split(" ")[0];
    // A shared first name must not silently select two different people.
    return normalized.includes(" " + name + " ") || (directory.filter((t) => normalizeName(t.full_name).split(" ")[0] === first).length === 1 && normalized.includes(" " + first + " "));
  }).map((p) => p.id);
}
export function selectedDraftTravelers(text: string, directory: TravelerRecord[], overrides: Record<string, boolean>) {
  const detected = new Set(detectedTravelers(text, directory));
  return directory.filter((p) => overrides[p.id] ?? detected.has(p.id)).map((p) => p.id);
}
export function blankTripCard(policy: PolicyRules, ids: string[] = [], language: "fr" | "en" = "en"): TripCard {
  return TripCardSchema.parse({ version: 1, revision: 0, language,
    travelers: field(ids, ids.length ? "Stated" : "Missing"), destination: field(null, "Missing"), meeting_date: field(null, "Missing"), meeting_start: field(null, "Missing"),
    meeting_end: field(null, "Default"), venue: field(null, "Default"), timezone: field(null, "Default"),
    outbound: field(null, "Default"), return: field(null, "Default"), hotel_nights: field(null, "Default"),
    budget: field(policy.max_trip_budget_per_traveler, "Policy", "Workspace policy"), cabin: field("economy", "Default"),
    hotel_cap: field(policy.hotel_cap_eur, "Policy", "Workspace policy"),
    class_rule: field("Economy for flights under " + policy.economy_under_hours + " h", "Policy", "Workspace policy"),
    arrival_margin: field(policy.arrival_margin_minutes, "Policy", "Workspace policy"),
    transport: field({}, "Default"), round_trip: field(true, "Default"),
    overrides: { outbound: false, return: false }, constraints: [], notes: [], validated_at: null,
  });
}
export function resolveJourneyMoment(value: unknown, meetingDate: string | null, direction: "outbound" | "return", current: JourneyMoment | null): JourneyMoment {
  const relative = RelativeJourneySchema.parse(value);
  if ([relative.date, relative.weekday, relative.relative_day].filter((v) => v !== null).length > 1) throw new DraftError("Choose one date, weekday or relative day for the journey.");
  if (!meetingDate) throw new DraftError("Specify the meeting date before changing the journey.");
  let date = relative.date ? draftDate(relative.date, new Date(meetingDate + "T12:00:00Z"), "UTC") : current?.date ?? meetingDate;
  if (relative.weekday !== null) {
    const weekday = new Date(meetingDate + "T12:00:00Z").getUTCDay();
    const delta = direction === "return" ? (relative.weekday - weekday + 7) % 7 : -((weekday - relative.weekday + 7) % 7);
    date = shiftDay(meetingDate, delta);
  } else if (relative.relative_day !== null) date = shiftDay(meetingDate, relative.relative_day);
  return { date, part: relative.part ?? current?.part ?? (direction === "outbound" ? "morning" : "evening") };
}
function recompute(card: TripCard, directory: TravelerRecord[]) {
  card.constraints = card.constraints.filter((entry) => usableDraftConstraint(entry.value));
  const destination = card.destination.value ? tripCity(card.destination.value) : undefined;
  card.timezone = field(destination?.timezone ?? null, "Default");
  if (card.venue.source === "Default") card.venue = field(destination ? destination.name + " city centre" : null, "Default");
  if (card.meeting_end.source === "Default") {
    const start = card.meeting_start.value;
    const minutes = start ? (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 120) % 1440 : null;
    card.meeting_end = field(minutes === null ? null : String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0"), "Default");
  }
  const date = card.meeting_date.value, start = card.meeting_start.value, end = card.meeting_end.value;
  const endDate = date && start && end ? shiftDay(date, end <= start ? 1 : 0) : null;
  if (date && card.outbound.value && card.outbound.value.date > date) card.overrides.outbound = false;
  if (endDate && card.return.value && card.return.value.date < endDate) card.overrides.return = false;
  if (!card.overrides.outbound) card.outbound = field(date && start ? { date: shiftDay(date, start < "11:00" ? -1 : 0), part: start < "11:00" ? "evening" : "morning" } : null, "Default");
  if (!card.overrides.return) card.return = field(endDate && end ? { date: shiftDay(endDate, end < "16:00" ? 0 : 1), part: end < "16:00" ? "evening" : "morning" } : null, "Default");
  card.hotel_nights = field(card.outbound.value && card.return.value ? Math.max(0, Math.round((Date.parse(card.return.value.date) - Date.parse(card.outbound.value.date)) / 86400000)) : null, "Default");
  card.transport = field(Object.fromEntries(directory.filter((p) => card.travelers.value.includes(p.id)).map((p) => [p.id, destination && (tripCity(p.home_city)?.name ?? normalizeName(p.home_city)) !== destination.name ? "flight" : "none"])), "Default");
  card.travelers.source = card.travelers.value.length ? (card.travelers.source === "Missing" ? "Stated" : card.travelers.source) : "Missing";
  return TripCardSchema.parse(card);
}
export function applyDraftChanges(previous: TripCard, changes: DraftChange[], directory: TravelerRecord[], source: "Stated" | "Edited", now = new Date()): TripCard {
  let card = structuredClone(previous);
  if (card.validated_at) throw new DraftError("This request is already validated.");
  // Meeting changes precede journey changes in the same message, independently of model order.
  const ordered = [...changes].sort((a, b) => changePriority(a.field) - changePriority(b.field));
  for (const change of ordered) {
    const { value } = change;
    switch (change.field) {
      case "destination": {
        const city = value === null ? null : tripCity(z.string().parse(value));
        if (value !== null && !city) throw new DraftError("Choose a destination from the city list in the card.");
        card.destination = field(city?.name ?? null, city ? source : "Missing"); break;
      }
      case "meeting_date": {
        const date = value === null ? null : draftDate(z.string().parse(value), now, tripCity(card.destination.value ?? "")?.timezone ?? "Europe/Paris");
        if (date !== card.meeting_date.value) card.overrides = { outbound: false, return: false };
        card.meeting_date = field(date, date ? source : "Missing"); break;
      }
      case "meeting_start": case "meeting_end": {
        const time = value === null ? null : normalizeDraftTime(value);
        card[change.field] = field(time, time ? source : change.field === "meeting_start" ? "Missing" : "Default"); break;
      }
      case "meeting_duration": {
        const minutes = z.number().int().positive().max(1440).parse(value);
        if (card.meeting_start.value) card.meeting_end = field(addDraftMinutes(card.meeting_start.value, minutes), source);
        break;
      }
      case "max_stops": card.max_stops = field(value === null ? null : z.number().int().min(0).max(2).parse(value), source); break;
      case "refundable_only": case "checked_bag_included": card[change.field] = field(value === null ? false : z.boolean().parse(value), source); break;
      case "departure_window": case "arrival_window": {
        const window = value === null ? null : DraftTimeWindowSchema.parse(value);
        const normalized = window ? { earliest: window.earliest ? normalizeDraftTime(window.earliest) : card[change.field].value?.earliest ?? null, latest: window.latest ? normalizeDraftTime(window.latest) : card[change.field].value?.latest ?? null } : null;
        if (normalized?.earliest && normalized.latest && normalized.earliest > normalized.latest) break;
        card[change.field] = field(normalized, source); break;
      }
      case "venue": card.venue = field(value === null ? null : z.string().trim().min(1).max(250).parse(value), value === null ? "Default" : source); break;
      case "budget": card.budget = field(value === null ? null : z.number().positive().max(1000000).parse(value), source); break;
      case "cabin": card.cabin = field(z.enum(["economy", "premium_economy", "business", "first"]).parse(value), source); break;
      case "hotel_cap": throw new DraftError("The hotel cap comes from your company policy. Edit it on the Policies page.");
      case "travelers": card.travelers = field(z.string().uuid().array().max(12).parse(value), source); break;
      case "add_traveler": case "remove_traveler": {
        const id = change.traveler_id ?? z.string().uuid().parse(value);
        card.travelers = field(change.field === "add_traveler" ? [...new Set([...card.travelers.value, id])] : card.travelers.value.filter((v) => v !== id), source); break;
      }
      case "outbound": case "return": {
        card = recompute(card, directory);
        if (value === null) { card.overrides[change.field] = false; break; }
        const moment = resolveJourneyMoment(value, card.meeting_date.value, change.field, card[change.field].value);
        card[change.field] = field(moment, source); card.overrides[change.field] = true; break;
      }
      case "hotel_nights": {
        card = recompute(card, directory);
        const nights = z.number().int().min(0).max(60).parse(value);
        if (!card.outbound.value) throw new DraftError("Specify the meeting date and start first.");
        card.return = field({ date: shiftDay(card.outbound.value.date, nights), part: card.return.value?.part ?? "evening" }, source);
        card.overrides.return = true; break;
      }
      case "note": break; // Free-form details are not search filters.
      case "constraint": {
        const text = z.string().trim().min(1).max(2000).parse(value);
        if (usableDraftConstraint(text) && !card.constraints.some((v) => v.value === text)) card.constraints.push(field(text, source));
        break;
      }
      case "remove_constraint": case "remove_note": {
        const key = change.field === "remove_note" ? "notes" : "constraints";
        card[key] = card[key].filter((v) => v.value !== value); break;
      }
    }
  }
  if (card.travelers.value.some((id) => !directory.some((p) => p.id === id))) throw new DraftError("Choose travelers from your workspace.");
  const updated = recompute(card, directory);
  if (changes.some((c) => c.field === "hotel_nights")) updated.hotel_nights.source = source;
  return updated;
}
export function interpretDraft(previous: TripCard, intent: DraftIntent, message: string, directory: TravelerRecord[], now = new Date(), first = false) {
  const card = { ...previous, language: intent.language };
  if (intent.confidence < 0.85 || intent.intent === "clarify" || intent.intent === "other" || intent.intent === "validate") return { card, applied: false };
  let next = card;
  // An odd optional detail must not roll back useful changes in the same message.
  for (const change of [...intent.changes, ...explicitDraftTimeWindows(message)].sort((a, b) => changePriority(a.field) - changePriority(b.field))) {
    if (change.field === "note") continue; // Unusable message details never become card notes.
    try { next = applyDraftChanges(next, [change], directory, first ? "Stated" : "Edited", now); }
    catch { /* Ignore unusable details; absent essentials are asked by the shared gate. */ }
  }
  return { card: next, applied: true };
}
export function changedDraftFields(before: TripCard, after: TripCard) {
  return (Object.keys(after) as (keyof TripCard)[]).filter((k) => !["revision", "language", "validated_at", "version", "overrides"].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
// Legacy free-text constraints are accepted only when they map to a real filter.
export function usableDraftConstraint(value: string) {
  const text = normalizeName(value);
  if (/^(?:vols? directs?(?: uniquement)?|direct flights?(?: only)?|non ?stop(?: flights?)?)$/.test(text)) return "max_stops";
  if (/^(?:billets? remboursables?(?: uniquement)?|refundable(?: flights?| tickets?)?(?: only)?)$/.test(text)) return "refundable_only";
  if (/^(?:bagage en soute(?: inclus)?|checked bag(?:gage)?(?: included)?)$/.test(text)) return "checked_bag_included";
  return null;
}
export function draftSearchConstraints(card: TripCard) {
  let max_stops = card.max_stops.value, refundable_only = card.refundable_only.value, checked_bag_included = card.checked_bag_included.value;
  for (const entry of card.constraints) {
    const name = usableDraftConstraint(entry.value);
    if (name === "max_stops") max_stops = 0;
    if (name === "refundable_only") refundable_only = true;
    if (name === "checked_bag_included") checked_bag_included = true;
  }
  return { max_stops, refundable_only, checked_bag_included };
}
export function normalizeDraftCard(card: TripCard, directory: TravelerRecord[]) {
  const next = structuredClone(card);
  next.travelers.value = next.travelers.value.filter((id) => directory.some((p) => p.id === id));
  return recompute(next, directory);
}
export function draftSummary(before: TripCard, after: TripCard, directory: TravelerRecord[]) {
  const fr = after.language === "fr", changed = changedDraftFields(before, after);
  const describe = (key: keyof TripCard) => {
    const labels: Record<string, string> = fr ? { travelers: "Voyageurs", destination: "Destination", meeting_date: "Réunion", meeting_start: "Début", meeting_end: "Fin", venue: "Lieu", outbound: "Aller", return: "Retour", budget: "Budget", cabin: "Classe", constraints: "Contraintes", notes: "Notes", max_stops: "Escales maximum", refundable_only: "Billets remboursables", checked_bag_included: "Bagage en soute", departure_window: "Départ", arrival_window: "Arrivée" } : { travelers: "Travelers", destination: "Destination", meeting_date: "Meeting", meeting_start: "Start", meeting_end: "End", venue: "Venue", outbound: "Outbound", return: "Return", budget: "Budget", cabin: "Cabin", constraints: "Constraints", notes: "Notes", max_stops: "Maximum stops", refundable_only: "Refundable fares", checked_bag_included: "Checked bag", departure_window: "Departure time", arrival_window: "Arrival time" };
    if (!labels[key]) return null;
    if (key === "travelers") return labels[key] + ": " + (directory.filter((p) => after.travelers.value.includes(p.id)).map((p) => p.full_name).join(", ") || (fr ? "aucun" : "none"));
    if (key === "constraints" || key === "notes") return labels[key] + ": " + (after[key].map((n) => n.value).join("; ") || (fr ? "aucune" : "none"));
    const entry = after[key] as { value: unknown }, value = entry.value;
    const parts = { morning: "matin", midday: "midi", afternoon: "après-midi", evening: "soir" };
    const rendered = value && typeof value === "object" && "date" in value ? (value as JourneyMoment).date + " " + (fr ? parts[(value as JourneyMoment).part] : (value as JourneyMoment).part) : value && typeof value === "object" && "earliest" in value && "latest" in value
      ? [(value as { earliest: string | null }).earliest, (value as { latest: string | null }).latest].map((v) => v ?? "—").join(" – ")
      : typeof value === "boolean" ? value ? fr ? "oui" : "yes" : fr ? "non" : "no" : String(value ?? (fr ? "non défini" : "not set"));
    return labels[key] + ": " + rendered;
  };
  const updates = changed.map(describe).filter(Boolean);
  const nights = after.hotel_nights.value;
  const consequence = nights !== null ? (fr ? `Hôtel : ${nights} nuit${nights === 1 ? "" : "s"}.` : `Hotel: ${nights} night${nights === 1 ? "" : "s"}.`) : "";
  const validation = draftValidation(after);
  return [updates.length ? updates.join(" · ") + "." : fr ? "Aucune modification appliquée." : "No changes applied.", consequence,
    validation.question || (fr ? "La proposition est prête : vérifiez la carte, puis validez pour rechercher." : "The proposal is ready: review the card, then validate to search.")].filter(Boolean).join(" ");
}
export function cardToValidatedPlan(input: TripCard, directory: TravelerRecord[]) {
  const card = normalizeDraftCard(input, directory);
  if (!draftValidation(card).canValidate) throw new DraftError("Complete the required fields before validating.");
  const city = tripCity(card.destination.value!)!;
  const start = zonedDateTimeToUtc(card.meeting_date.value!, card.meeting_start.value!, city.timezone, "compatible");
  const end = zonedDateTimeToUtc(shiftDay(card.meeting_date.value!, card.meeting_end.value! <= card.meeting_start.value! ? 1 : 0), card.meeting_end.value!, city.timezone, "compatible");
  const people = directory.filter((p) => card.travelers.value.includes(p.id));
  const windows = { morning: { earliest: "06:00", latest: "11:59" }, midday: { earliest: "11:00", latest: "13:59" }, afternoon: { earliest: "12:00", latest: "17:59" }, evening: { earliest: "18:00", latest: "23:59" } };
  const filters = draftSearchConstraints(card);
  const journey = JourneySchema.parse({ transport: "flight", destination_iata: city.airport, departure_date: card.outbound.value!.date,
    return_date: card.return.value!.date, one_way: false, hotel_needed: card.hotel_nights.value! > 0,
    hotel_checkin: card.outbound.value!.date, hotel_checkout: card.return.value!.date, hotel_query: card.venue.value,
    cabin: card.cabin.value, max_stops: filters.max_stops, refundable_only: filters.refundable_only, checked_bag_included: filters.checked_bag_included,
    departure_window: card.departure_window.value ?? windows[card.outbound.value!.part], arrival_window: card.arrival_window.value, unsupported_constraints: [],
  });
  const meeting = { title: "Meeting in " + city.name, start, end, timezone: city.timezone, location: card.venue.value!, google_event_id: null };
  const request = { title: "Team trip to " + city.name, destination: city.name, language: card.language, travelers: people.map((p) => ({ name: p.full_name, email: p.email })), meeting, budget_per_traveler: card.budget.value,
    constraints: [...card.constraints.map((c) => c.value), "Return preference: " + card.return.value!.date + " " + card.return.value!.part], missingFields: [] };
  // Explicit meeting: skip the legacy calendar-matching step without altering that flow.
  const workflow = PlanningStateSchema.parse({ traveler_ids: card.travelers.value, journey,
    coordination: { meeting_checked: true, traveler_journeys: Object.fromEntries(people.map((p) => [p.id, { ...journey, transport: card.transport.value[p.id] ?? "flight" }])) } });
  return { card, request, journey, meeting, workflow };
}

// Provider calls and quote execution stay unchanged. Newly validated drafts also
// filter the returned offers against the manager's chosen return period.
export function filterDraftReturnFlights<T extends { details?: Record<string, unknown> }>(flights: T[], card: TripCard, timezone: string): T[] {
  const moment = card.return.value;
  if (!moment) return flights;
  const limits = { morning: ["06:00", "11:59"], midday: ["11:00", "13:59"], afternoon: ["12:00", "17:59"], evening: ["18:00", "23:59"] };
  return flights.filter((flight) => {
    const inbound = flight.details?.inbound as { departure?: string } | null | undefined;
    if (!inbound?.departure || !Number.isFinite(Date.parse(inbound.departure))) return false;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(inbound.departure));
    const get = (key: string) => parts.find((p) => p.type === key)!.value;
    const date = get("year") + "-" + get("month") + "-" + get("day"), time = get("hour") + ":" + get("minute");
    return date === moment.date && time >= limits[moment.part][0] && time <= limits[moment.part][1];
  });
}
