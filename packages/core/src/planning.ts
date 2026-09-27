import {
  BookingDetailsSchema, FlightDetailsSchema, HotelDetailsSchema, JourneySchema, MeetingSchema,
  TravelerInputSchema, type RequestExtraction, type TravelerRecord, type TravelRequest,
  type SearchResult, type PolicyRules, type TripOption, type PlanTraveler,
} from "@repo/types";
import { zonedDateTimeToUtc } from "./dates";
import { addDraftMinutes, normalizeDraftTime, resolveDraftDate } from "./draft-inputs";
import { tripCity } from "./trip-cities";
import { usableDraftConstraint } from "./trip-draft";
import { rankOptions } from "./scoring";
import { travelerCost } from "./policy";

export class PlanningError extends Error {}

const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
export function resolveRequest(extracted: RequestExtraction, existing: TravelerRecord[], selectedIds: string[], now: Date) {
  const fr = extracted.language === "fr";
  // Never trust model-authored missingFields: optional details cannot become gates.
  const missing: string[] = [];
  const ask = (en: string, french: string) => missing.push(fr ? french : en);
  const travelerQuestions: string[] = [];
  const travelerIds = new Set(selectedIds);
  const newTravelers: ReturnType<typeof TravelerInputSchema.parse>[] = [];
  for (const person of extracted.travelers) {
    const matches = existing.filter((t) => person.email
      ? t.email.toLowerCase() === person.email.toLowerCase()
      : normalized(t.full_name) === normalized(person.name)
        || normalized(t.full_name).split(" ")[0] === normalized(person.name));
    if (matches.length === 1) travelerIds.add(matches[0].id);
    else if (matches.length > 1) travelerQuestions.push(fr ? "Précisez l’adresse e-mail de " + person.name + "." : "Specify the email for " + person.name + ".");
    else {
      const candidate = TravelerInputSchema.safeParse({ full_name: person.name, email: person.email, home_city: person.home_city, home_airport: person.home_airport });
      if (candidate.success) {
        if (!newTravelers.some((t) => t.email === candidate.data.email)) newTravelers.push(candidate.data);
      }
    }
  }
  for (const id of travelerIds) if (!existing.some((t) => t.id === id)) travelerIds.delete(id);
  const count = travelerIds.size + newTravelers.length;
  if (!count) ask(travelerQuestions[0] ?? "Who is traveling?", travelerQuestions[0] ?? "Qui voyage ?");
  if (!extracted.destination) ask("What is the destination?", "Quelle est la destination ?");
  const city = tripCity(extracted.destination ?? "");
  const timezone = city?.timezone ?? "Europe/Paris";
  const date = (value: string | null): string | null => {
    if (!value) return null;
    try { return resolveDraftDate(value, now, timezone); } catch { return null; }
  };
  const time = (value: string | null) => {
    try { return normalizeDraftTime(value); } catch { return null; }
  };
  const shift = (value: string, days: number) => new Date(Date.parse(value + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const input = extracted.meeting, meetingDate = date(input?.date ?? null), startTime = time(input?.start_time ?? null);
  if (!meetingDate) ask("What is the meeting date?", "Quelle est la date de réunion ?");
  if (!startTime) ask("What time does the meeting start?", "À quelle heure commence la réunion ?");
  const endTime = time(input?.end_time ?? null) ?? (startTime ? addDraftMinutes(startTime, 120) : null);
  const endDate = meetingDate && startTime && endTime ? shift(meetingDate, endTime <= startTime ? 1 : 0) : null;
  const venue = input?.location.trim() || (extracted.destination ?? "") + " city centre";
  const meeting = meetingDate && startTime && endTime && endDate ? MeetingSchema.parse({
    title: input?.title || "Meeting", location: venue, timezone, google_event_id: null,
    start: zonedDateTimeToUtc(meetingDate, startTime, timezone, "compatible"),
    end: zonedDateTimeToUtc(endDate, endTime, timezone, "compatible"),
  }) : null;
  const defaultDeparture = meetingDate && startTime ? shift(meetingDate, startTime < "11:00" ? -1 : 0) : null;
  const defaultReturn = endDate && endTime ? shift(endDate, endTime < "16:00" ? 0 : 1) : null;
  const requestedDeparture = date(extracted.journey.departure_date), requestedReturn = date(extracted.journey.return_date);
  const departure = requestedDeparture && meetingDate && requestedDeparture <= meetingDate ? requestedDeparture : defaultDeparture;
  const returning = requestedReturn && endDate && requestedReturn >= endDate ? requestedReturn : defaultReturn;
  const requestedCheckin = date(extracted.journey.hotel_checkin), requestedCheckout = date(extracted.journey.hotel_checkout);
  const validStay = requestedCheckin && requestedCheckout && requestedCheckout > requestedCheckin;
  const checkin = validStay ? requestedCheckin : departure, checkout = validStay ? requestedCheckout : returning;
  const journey = JourneySchema.parse({
    ...extracted.journey, transport: extracted.journey.transport ?? "flight",
    destination_iata: extracted.journey.destination_iata ?? city?.airport ?? null,
    departure_date: departure, return_date: returning, one_way: extracted.journey.one_way ?? false,
    hotel_needed: extracted.journey.hotel_needed ?? Boolean(checkin && checkout && checkout > checkin),
    hotel_checkin: checkin, hotel_checkout: checkout, hotel_query: venue,
    cabin: extracted.journey.cabin ?? "economy", unsupported_constraints: [],
  });
  const requestedBudget = extracted.budget_per_traveler ?? (extracted.total_budget !== null && count ? Math.floor(extracted.total_budget * 100 / count) / 100 : null);
  const budget = requestedBudget && requestedBudget > 0 ? requestedBudget : null;
  const request: TravelRequest = {
    title: extracted.title, destination: extracted.destination, language: extracted.language,
    travelers: extracted.travelers.map((p) => ({ name: p.name, email: p.email && /^[^@]+@[^@]+\.[^@]+$/.test(p.email) ? p.email : null })),
    meeting, budget_per_traveler: budget, constraints: extracted.constraints.filter((value) => usableDraftConstraint(value)), missingFields: [...new Set(missing)],
  };
  return { request, journey, travelerIds: [...travelerIds], newTravelers };
}

export function effectivePolicy(policy: PolicyRules, budget: number | null): PolicyRules {
  const limits = [policy.max_trip_budget_per_traveler, budget].filter((n): n is number => n !== null && n > 0);
  return { ...policy, max_trip_budget_per_traveler: limits.length ? Math.min(...limits) : null };
}

export function buildBundles(searches: Record<string, SearchResult>, meetingStart: string, policy: PolicyRules) {
  const entries = Object.entries(searches);
  if (!entries.length) throw new PlanningError("No travelers have search results.");
  const variants = ["Lowest cost", "Balanced", "Most flexible"] as const;
  const bundles: { id: string; label: string; per_traveler: TripOption["per_traveler"]; meeting_start: string }[] = [];
  const fingerprints = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const per_traveler = entries.map(([traveler_id, result]) => {
      const flights = [...result.flights].sort((a, b) => {
        if (index === 2) {
          const flex = Number(FlightDetailsSchema.parse(b.details).refundable === true) - Number(FlightDetailsSchema.parse(a.details).refundable === true);
          if (flex) return flex;
        }
        if (index === 1) return (a.price_eur + a.duration_minutes * 0.3) - (b.price_eur + b.duration_minutes * 0.3);
        return a.price_eur - b.price_eur;
      });
      const hotels = [...result.hotels].sort((a, b) => {
        if (index === 2) {
          const flex = Number(HotelDetailsSchema.parse(b.details).refundable === true) - Number(HotelDetailsSchema.parse(a.details).refundable === true);
          if (flex) return flex;
        }
        return (a.total_eur ?? a.nightly_eur * a.nights) - (b.total_eur ?? b.nightly_eur * b.nights);
      });
      return { traveler_id, flight: flights[0] ?? null, hotel: hotels[0] ?? null };
    });
    const fingerprint = JSON.stringify(per_traveler);
    if (!fingerprints.has(fingerprint)) {
      fingerprints.add(fingerprint);
      const allRefundable = per_traveler.every((p) => (!p.flight || FlightDetailsSchema.parse(p.flight.details).refundable === true) && (!p.hotel || HotelDetailsSchema.parse(p.hotel.details).refundable === true));
      bundles.push({ id: "bundle-" + index, label: index === 2 && !allRefundable ? "Flexibility comparison" : variants[index], per_traveler, meeting_start: meetingStart });
    }
  }
  // Distinct alternatives only, when the live inventory supports them.
  for (const [travelerId, result] of entries) {
    for (const candidate of [...result.flights.map((flight) => ({ flight })), ...result.hotels.map((hotel) => ({ hotel }))]) {
      if (bundles.length >= 3) break;
      const per_traveler = bundles[0].per_traveler.map((p) => p.traveler_id === travelerId ? { ...p, ...candidate } : p);
      const key = JSON.stringify(per_traveler);
      if (!fingerprints.has(key)) { fingerprints.add(key); bundles.push({ id: "bundle-alt-" + bundles.length, label: "Alternative " + (bundles.length + 1), per_traveler, meeting_start: meetingStart }); }
    }
  }
  return rankOptions(bundles, policy).map((ranked) => ({ ...ranked, label: bundles.find((b) => b.id === ranked.option.id)!.label }));
}

export function assertBookingReady(option: TripOption, travelers: PlanTraveler[], now: Date) {
  if (!option.selected || (!option.compliant && !option.exception_approved)) throw new PlanningError("Select an option and approve any policy exception first.");
  if (!travelers.length || travelers.some((t) => t.confirmation_status !== "confirmed")) throw new PlanningError("Every traveler must be confirmed.");
  for (const item of option.per_traveler) {
    const person = travelers.find((t) => t.traveler_id === item.traveler_id);
    if (!person) throw new PlanningError("A selected traveler is missing.");
    const parsed = BookingDetailsSchema.safeParse(person.booking_details);
    if (!parsed.success) throw new PlanningError("Complete the booking details for every traveler.");
    const details = parsed.data;
    if (item.flight) {
      if (!details.date_of_birth || !details.gender) throw new PlanningError("Flight travelers need their date of birth and document gender.");
      const departureDate = item.flight.departure.slice(0, 10);
      const twelfthBirthday = String(Number(details.date_of_birth.slice(0, 4)) + 12) + details.date_of_birth.slice(4);
      if (twelfthBirthday > departureDate) throw new PlanningError("This business travel flow supports adult passengers (12+) only.");
    }
    if (details.date_of_birth && details.date_of_birth >= now.toISOString().slice(0, 10)) throw new PlanningError("Date of birth must be in the past.");
    for (const offer of [item.flight ? FlightDetailsSchema.parse(item.flight.details) : null, item.hotel ? HotelDetailsSchema.parse(item.hotel.details) : null]) {
      if (offer?.expires_at && Date.parse(offer.expires_at) <= now.getTime()) throw new PlanningError("An offer expired. Search again and approve a fresh option.");
    }
  }
  return option.per_traveler.map((item) => ({ traveler_id: item.traveler_id, cost_eur: travelerCost(item) }));
}
