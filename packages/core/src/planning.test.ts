import { describe, expect, it } from "vitest";
import { BookingDetailsSchema, DEFAULT_POLICY, type RequestExtraction, type TravelerRecord, type TripOption, type PlanTraveler } from "@repo/types";
import { resolveRequest, effectivePolicy, assertBookingReady } from "./planning";
import { travelerCost } from "./policy";
import { calendarFile } from "./calendar-file";
const id = "11111111-1111-4111-8111-111111111111";
const person: TravelerRecord = { id, owner_id: id, full_name: "Alice Martin", email: "alice@example.com", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T12:00:00Z" };
const extraction: RequestExtraction = {
  title: "Team meeting", destination: "Berlin", language: "fr", travelers: [{ name: "Alice", email: null, home_city: null, home_airport: null }],
  meeting: { title: "Team meeting", date: "mardi", end_date: null, start_time: "14:00", end_time: "16:00", timezone: "Europe/Paris", location: "Berlin" },
  budget_per_traveler: null, total_budget: 1000, constraints: [], missingFields: [],
  journey: { transport: "flight", destination_iata: "BER", departure_date: "mardi", return_date: "mercredi", one_way: false, hotel_needed: true,
    hotel_checkin: "mardi", hotel_checkout: "mercredi", hotel_query: "Berlin", cabin: null, max_stops: null, refundable_only: false,
    checked_bag_included: false, departure_window: null, arrival_window: null, unsupported_constraints: [] },
};
describe("request resolution", () => {
  it("resolves relative dates deterministically in Paris and matches an existing traveler", () => {
    const result = resolveRequest(extraction, [person], [], new Date("2026-09-27T12:00:00Z"));
    expect(result.travelerIds).toEqual([id]); expect(result.newTravelers).toEqual([]);
    expect(result.journey.departure_date).toBe("2026-09-29");
    expect(result.request.meeting?.start).toBe("2026-09-29T12:00:00.000Z");
    expect(result.request.budget_per_traveler).toBe(1000);
    expect(result.request.missingFields).toEqual([]);
  });
  it("asks for ambiguous traveler identities instead of picking the first match", () => {
    const result = resolveRequest(extraction, [person, { ...person, id: "22222222-2222-4222-8222-222222222222", full_name: "Alice Dupont", email: "other@example.com" }], [], new Date("2026-09-27T12:00:00Z"));
    expect(result.travelerIds).toEqual([]); expect(result.request.missingFields.join(" ")).toContain("e-mail");
  });
  it("does not invent contact data and ignores unsupported constraints", () => {
    const input = structuredClone(extraction); input.journey.return_date = null; input.journey.unsupported_constraints = ["Train only"];
    const result = resolveRequest(input, [], [], new Date("2026-09-27T12:00:00Z"));
    expect(result.newTravelers).toEqual([]);
    expect(result.request.missingFields).toEqual(["Qui voyage ?"]);
    expect(result.journey.return_date).toBe("2026-09-30");
    expect(result.journey.unsupported_constraints).toEqual([]);
  });
  it("only asks about missing travelers, destination, meeting date and start", () => {
    const input = structuredClone(extraction);
    input.missingFields = ["Clarify train and hotel", "Do you have a loyalty card?"];
    input.constraints = ["Train only", "Vegetarian"];
    input.meeting!.end_time = null; input.meeting!.location = "";
    input.journey.return_date = null; input.journey.departure_date = null;
    input.journey.hotel_needed = null; input.journey.transport = null;
    input.journey.one_way = null; input.journey.unsupported_constraints = ["Train only"];
    const result = resolveRequest(input, [person], [], new Date("2026-09-27T12:00:00Z"));
    expect(result.request.missingFields).toEqual([]); expect(result.request.constraints).toEqual([]);
    expect(result.request.meeting?.end).toBe("2026-09-29T14:00:00.000Z");
    expect(result.journey).toMatchObject({ transport: "flight", one_way: false, return_date: "2026-09-30", hotel_query: "Berlin city centre", unsupported_constraints: [] });
  });
  it("creates only complete, explicitly supplied traveler records", () => {
    const input = structuredClone(extraction); input.travelers[0] = { name: "Alice Martin", email: "ALICE@example.com", home_city: "Paris", home_airport: "CDG" };
    expect(resolveRequest(input, [], [], new Date("2026-09-27T12:00:00Z")).newTravelers[0]).toMatchObject({ email: "alice@example.com" });
  });
  it("keeps the stricter budget and accounts for fractional nightly rates without rounding a stay incorrectly", () => {
    expect(effectivePolicy({ ...DEFAULT_POLICY, max_trip_budget_per_traveler: 400 }, 500).max_trip_budget_per_traveler).toBe(400);
    expect(travelerCost({ traveler_id: id, flight: null, hotel: { nights: 3, nightly_eur: 100 / 3, total_eur: 100 } })).toBe(100);
  });
});
describe("booking preconditions", () => {
  const details = BookingDetailsSchema.parse({ first_name: "Alice", last_name: "Martin", passenger_type: "ADULT", date_of_birth: "1990-01-01", gender: "FEMALE", phone: "+33612345678", no_extras: true });
  const option: TripOption = { id, owner_id: id, trip_id: id, label: "Hotel", rank: 1, total_eur: 100, per_traveler: [{ traveler_id: id, flight: null, hotel: { nights: 1, nightly_eur: 100,
    details: { token: "htl_test", name: "Hotel", expires_at: null, refundable: null, cancellation_terms: null, hotel_id: "hotel", address: "", checkin: "2026-11-11", checkout: "2026-11-12", timezone: "Europe/Paris", room: "", board: "", total_eur: 100, extra_taxes: [] } } }],
    compliant: false, violations: [], explanation: "", selected: true, exception_approved: false, exception_note: null };
  const traveler: PlanTraveler = { owner_id: id, trip_id: id, traveler_id: id, traveler: person, availability: null, confirmation_status: "confirmed", response_text: null, booking_details: details };
  it("blocks policy exceptions, missing confirmation and incomplete booking data", () => {
    expect(() => assertBookingReady(option, [traveler], new Date())).toThrow(/exception/);
    expect(() => assertBookingReady({ ...option, compliant: true }, [{ ...traveler, confirmation_status: "pending" }], new Date())).toThrow(/confirmed/);
    expect(() => assertBookingReady({ ...option, compliant: true }, [{ ...traveler, booking_details: null }], new Date())).toThrow(/details/);
    expect(assertBookingReady({ ...option, exception_approved: true }, [traveler], new Date())).toEqual([{ traveler_id: id, cost_eur: 100 }]);
  });
});
describe("calendar export", () => {
  it("exports UTC flight times and date-only hotel nights, with stable IDs and escaped content", () => {
    const result = calendarFile(id, [
      { id: "flight", start: "2026-11-11T08:00:00+01:00", end: "2026-11-11T09:00:00+01:00", allDay: false, title: "Flight, team\nBEGIN:VEVENT", location: "A;B", tentative: true },
      { id: "hotel", start: "2026-11-11", end: "2026-11-13", allDay: true, title: "Hôtel " + "é".repeat(70), location: "Berlin", tentative: true },
    ], new Date("2026-09-27T12:00:00Z"));
    expect(result).toContain("DTSTART:20261111T070000Z");
    expect(result).toContain("DTEND;VALUE=DATE:20261113");
    expect(result).toContain("SUMMARY:Flight\\, team\\nBEGIN:VEVENT");
    expect(result).toContain("STATUS:TENTATIVE");
    expect(result.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
