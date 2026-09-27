import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import flights from "./__fixtures__/flight_search.json";
import hotels from "./__fixtures__/hotel_search.json";
import { euroAmount, parseFlights, parseHotels, toolData } from "./jinko-contract";
import type { Journey } from "@repo/types";
const journey: Journey = {
  transport: "flight", destination_iata: "BER", departure_date: "2026-11-11", return_date: "2026-11-13", one_way: false,
  hotel_needed: true, hotel_checkin: "2026-11-11", hotel_checkout: "2026-11-13", hotel_query: "Berlin", cabin: null,
  max_stops: null, refundable_only: false, checked_bag_included: false, departure_window: null, arrival_window: null, unsupported_constraints: [],
};
const meeting = { title: "Meeting", location: "Berlin", start: "2026-11-11T17:00:00Z", end: "2026-11-13T16:00:00Z", timezone: "Europe/Paris", google_event_id: null };
describe("captured live Jinko MCP contract", () => {
  it("reads the MCP wrapper and formatted fare price, filters late arrivals and keeps the return", () => {
    const result = parseFlights(flights, journey, meeting, "CDG");
    expect(result.flights).toHaveLength(3);
    expect(result.flights[0]).toMatchObject({ departure: "2026-11-11T06:00:00.000Z", arrival: "2026-11-11T07:50:00.000Z", price_eur: 129.17,
      details: { inbound: { departure: "2026-11-13T20:35:00.000Z", destination: "CDG" } } });
  });
  it("does not silently accept wrong origins, missing offsets, an early return or unapplied constraints", () => {
    expect(parseFlights(flights, journey, meeting, "ORY").flights).toHaveLength(0);
    expect(parseFlights(flights, { ...journey, refundable_only: true }, meeting, "CDG").flights).toHaveLength(0);
    expect(parseFlights(flights, journey, { ...meeting, end: "2026-11-13T22:00:00Z" }, "CDG").flights).toHaveLength(0);
    const invalid = structuredClone(flights); invalid.structuredContent.data.flights[1].outbound_arrival = "2026-11-11T08:50:00";
    expect(parseFlights(invalid, journey, meeting, "CDG").flights).toHaveLength(0);
    expect(parseFlights(flights, { ...journey, checked_bag_included: true }, meeting, "CDG").flights).toHaveLength(2);
  });
  it("includes known excluded hotel taxes once, preserving the full-stay total", () => {
    const result = parseHotels(hotels, journey, meeting.timezone);
    expect(result.hotels[0]).toMatchObject({ nights: 2, total_eur: 407.73, nightly_eur: 203.865 });
    expect(result.hotels[0].details).toMatchObject({ name: "Meliá Berlin", extra_taxes: expect.arrayContaining([expect.stringContaining("24.80")]) });
    const unexpected = structuredClone(hotels); unexpected.structuredContent.data.hotels[0].rooms[0].rates[0].currency = "USD";
    expect(parseHotels(unexpected, journey, meeting.timezone).hotels).toHaveLength(1);
  });
  it("rejects error envelopes and never reads an unstructured text summary as data", () => {
    expect(() => toolData({ isError: true, structuredContent: { status: "error", error: "invalid_api_key" } })).toThrow(/JINKO_API_KEY/);
    expect(() => toolData({ content: [{ text: "Flight EUR 1" }] })).toThrow(/structuredContent/);
  });
  it("distinguishes decimal major amounts and scaled minor amounts without assuming currency conversion", () => {
    expect(euroAmount("EUR 129.17")).toBe(129.17);
    expect(euroAmount({ amount: 129.17, currency: "EUR" })).toBe(129.17);
    expect(euroAmount({ value: 129170, decimal_places: 3, currency: "EUR" })).toBe(129.17);
    expect(() => euroAmount({ value: 12917, currency: "EUR" })).toThrow();
    expect(() => euroAmount("USD 129.17")).toThrow();
    expect(() => euroAmount("EUR -10")).toThrow();
  });
});
