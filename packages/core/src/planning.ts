import {
  BookingDetailsSchema, FlightDetailsSchema, HotelDetailsSchema, JourneySchema, MeetingSchema,
  TravelerInputSchema, type RequestExtraction, type TravelerRecord, type TravelRequest,
  type SearchResult, type PolicyRules, type TripOption, type PlanTraveler,
} from "@repo/types";
import { resolveRelativeDate, zonedDateTimeToUtc } from "./dates";
import { rankOptions } from "./scoring";
import { travelerCost } from "./policy";

export class PlanningError extends Error {}

const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
export function resolveRequest(extracted: RequestExtraction, existing: TravelerRecord[], selectedIds: string[], now: Date) {
  const fr = extracted.language === "fr";
  const missing: string[] = [...extracted.missingFields];
  const ask = (en: string, french: string) => missing.push(fr ? french : en);
  const travelerIds = new Set(selectedIds);
  const newTravelers: ReturnType<typeof TravelerInputSchema.parse>[] = [];
  for (const person of extracted.travelers) {
    const matches = existing.filter((t) => person.email
      ? t.email.toLowerCase() === person.email.toLowerCase()
      : normalized(t.full_name) === normalized(person.name)
        || normalized(t.full_name).split(" ")[0] === normalized(person.name));
    if (matches.length === 1) travelerIds.add(matches[0].id);
    else if (matches.length > 1) ask("Specify the email for " + person.name + ".", "Précisez l’adresse e-mail de " + person.name + ".");
    else {
      const candidate = TravelerInputSchema.safeParse({ full_name: person.name, email: person.email, home_city: person.home_city, home_airport: person.home_airport });
      if (candidate.success) {
        if (!newTravelers.some((t) => t.email === candidate.data.email)) newTravelers.push(candidate.data);
      } else ask("Add " + person.name + " in Travelers with an email, home city and airport, then retry.", "Ajoutez " + person.name + " dans Travelers avec son e-mail, sa ville et son aéroport de départ, puis réessayez.");
    }
  }
  for (const id of travelerIds) if (!existing.some((t) => t.id === id)) throw new PlanningError("A selected traveler is not available.");
  const count = travelerIds.size + newTravelers.length;
  if (!count) ask("Who is traveling? Select or name the travelers.", "Qui voyage ? Sélectionnez ou nommez les voyageurs.");
  if (count > 12) ask("Split this request into groups of up to 12 travelers.", "Répartissez la demande en groupes de 12 voyageurs maximum.");
  const date = (value: string | null, label: string): string | null => {
    if (!value) return null;
    try { return resolveRelativeDate(value, now, "Europe/Paris"); }
    catch { missing.push(label + ": " + value); return null; }
  };
  let meeting: TravelRequest["meeting"] = null;
  const input = extracted.meeting;
  if (input) {
    const startDate = date(input.date, "Meeting date");
    const endDate = date(input.end_date ?? input.date, "Meeting end date");
    try {
      if (startDate && endDate && input.start_time && input.end_time) meeting = MeetingSchema.parse({
        title: input.title, location: input.location, timezone: input.timezone || "Europe/Paris", google_event_id: null,
        start: zonedDateTimeToUtc(startDate, input.start_time, input.timezone || "Europe/Paris"),
        end: zonedDateTimeToUtc(endDate, input.end_time, input.timezone || "Europe/Paris"),
      });
    } catch { ask("Clarify meeting dates, times and time zone (ambiguous clock changes need clarification).", "Précisez les dates, horaires et fuseau de la réunion (attention aux changements d’heure)."); }
  }
  if (!meeting) ask("Give the meeting date, start/end times, time zone and venue.", "Indiquez la date, les heures de début et de fin, le fuseau et le lieu de la réunion.");
  else if (Date.parse(meeting.start) <= now.getTime()) ask("The meeting must be in the future.", "La réunion doit être dans le futur.");
  if (meeting && !meeting.location.trim()) ask("Specify the meeting venue.", "Précisez le lieu de la réunion.");
  if (!extracted.destination) ask("What is the destination?", "Quelle est la destination ?");
  const journey = JourneySchema.parse({
    ...extracted.journey,
    departure_date: date(extracted.journey.departure_date, "Departure date"),
    return_date: date(extracted.journey.return_date, "Return date"),
    hotel_checkin: date(extracted.journey.hotel_checkin, "Hotel check-in"),
    hotel_checkout: date(extracted.journey.hotel_checkout, "Hotel check-out"),
  });
  if (!journey.transport) ask("Do you need flights, or only a hotel?", "Faut-il des vols ou uniquement un hôtel ?");
  if (journey.transport === "flight") {
    if (!journey.destination_iata || !journey.departure_date) ask("Specify the destination airport and departure date.", "Précisez l’aéroport d’arrivée et la date de départ.");
    if (journey.one_way === null || (!journey.one_way && !journey.return_date)) ask("Specify the return date, or explicitly request one-way travel.", "Précisez la date de retour, ou demandez explicitement un aller simple.");
    if (journey.departure_date && journey.departure_date < resolveRelativeDate("today", now)) ask("Departure must be today or later.", "Le départ doit être aujourd’hui ou plus tard.");
    if (journey.return_date && journey.departure_date && journey.return_date < journey.departure_date) ask("Return must follow departure.", "Le retour doit suivre le départ.");
  }
  if (journey.hotel_needed === null) ask("Do you need a hotel? Specify check-in and check-out dates.", "Faut-il un hôtel ? Précisez les dates d’arrivée et de départ.");
  if (journey.hotel_needed && (!journey.hotel_checkin || !journey.hotel_checkout || !journey.hotel_query || journey.hotel_checkout <= journey.hotel_checkin)) {
    ask("Specify the hotel location and check-in/check-out dates.", "Précisez le lieu de recherche de l’hôtel et les dates d’arrivée et de départ.");
  }
  if (journey.transport === "none" && journey.hotel_needed === false) ask("This request contains no flight or hotel to arrange.", "Cette demande ne contient ni vol ni hôtel à organiser.");
  if (journey.unsupported_constraints.length) ask(
    "Clarify these constraints before searching: " + journey.unsupported_constraints.join("; "),
    "Précisez ces contraintes avant la recherche : " + journey.unsupported_constraints.join(" ; "));
  const budget = extracted.budget_per_traveler ?? (extracted.total_budget !== null && count ? Math.floor(extracted.total_budget * 100 / count) / 100 : null);
  if (budget === 0) ask("Specify a positive travel budget.", "Précisez un budget voyage supérieur à zéro.");
  const request: TravelRequest = {
    title: extracted.title, destination: extracted.destination, language: extracted.language,
    travelers: extracted.travelers.map((p) => ({ name: p.name, email: p.email && /^[^@]+@[^@]+\.[^@]+$/.test(p.email) ? p.email : null })),
    meeting, budget_per_traveler: budget, constraints: extracted.constraints, missingFields: [...new Set(missing)],
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
