import "server-only";
import { z } from "zod";
import { CabinSchema, FlightSchema, FlightDetailsSchema, HotelSchema, HotelDetailsSchema, TimestampSchema, type Journey, type Meeting } from "@repo/types";
import { IntegrationError } from "./errors";

const record = z.record(z.unknown());
export function toolData(result: unknown): Record<string, unknown> {
  const envelope = z.object({ isError: z.boolean().optional(), structuredContent: record.optional() }).parse(result);
  const content = envelope.structuredContent;
  if (!content) throw new IntegrationError("Jinko", "INVALID_RESPONSE", "Jinko returned no structuredContent. The MCP response contract needs checking.");
  if (envelope.isError || content.status === "error" || content.error) {
    const error = typeof content.error === "string" ? content.error : record.safeParse(content.error).data?.code;
    const code = typeof error === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(error) ? error : "TOOL_ERROR";
    const guidance = /invalid_api_key|AUTH_REQUIRED/i.test(code)
      ? "Check JINKO_API_KEY, JINKO_MCP_URL and JINKO_API_KEY_HEADER; the key must match the configured environment."
      : "Check the selected offer and provider availability before retrying.";
    throw new IntegrationError("Jinko", code, "Jinko: " + code + ". " + guidance);
  }
  // Verified live MCP envelope on 2026-09-27 (see docs/jinko-contract.md).
  return content.status === "success" ? record.parse(content.data) : content;
}
const money = z.union([
  z.string().regex(/^EUR [0-9]+(?:\.[0-9]+)?$/).transform((s) => Number(s.slice(4))),
  z.object({ currency: z.literal("EUR"), amount: z.number().nonnegative(), decimal_places: z.number().int().min(0).max(6).optional() })
    .transform((m) => m.amount / 10 ** (m.decimal_places ?? 0)),
  z.object({ currency: z.literal("EUR"), value: z.number().int().nonnegative(), decimal_places: z.number().int().min(0).max(6) })
    .transform((m) => m.value / 10 ** m.decimal_places),
]);
export const euroAmount = (input: unknown) => Math.round(money.parse(input) * 100) / 100;
const SegmentSchema = z.object({
  departure_airport: z.string(), arrival_airport: z.string(),
  departure_time: TimestampSchema, arrival_time: TimestampSchema,
  airline: z.string(), flight_number: z.string(), operating_carrier: z.string().optional(),
});
const FareSchema = z.object({
  trip_item_token: z.string().min(1), brand_name: z.string().default(""),
  cabin_class: CabinSchema, total_price: money, refundable: z.boolean().nullable().default(null),
  checked_bag_included: z.boolean().nullable().default(null), expires_at: TimestampSchema.optional(),
}).passthrough();
const FlightResultSchema = z.object({
  origin: z.string(), destination: z.string(), is_round_trip: z.boolean(),
  outbound_departure: TimestampSchema, outbound_arrival: TimestampSchema,
  outbound_duration_min: z.number().int().positive(), outbound_stops: z.number().int().nonnegative(),
  outbound_airline: z.string(), outbound_segments: SegmentSchema.array().min(1),
  inbound_departure: TimestampSchema.optional(), inbound_arrival: TimestampSchema.optional(),
  inbound_duration_min: z.number().int().positive().optional(), inbound_airline: z.string().optional(),
  inbound_segments: SegmentSchema.array().optional(), fares: FareSchema.array(),
});
const utc = (value: string) => new Date(value).toISOString();
function inWindow(value: string, window: Journey["departure_window"]) {
  const time = value.slice(11, 16);
  return !window || ((!window.earliest || time >= window.earliest) && (!window.latest || time <= window.latest));
}
export function parseFlights(raw: unknown, journey: Journey, meeting: Meeting, homeAirport: string) {
  const data = z.object({ flights: z.array(z.unknown()), unapplied_filters: z.array(z.unknown()).optional() }).parse(toolData(raw));
  const warnings: string[] = [];
  if (data.unapplied_filters?.length) warnings.push("Some search filters were not enforced by Jinko; matching times, cabin, stops and baggage are checked again.");
  const flights: z.infer<typeof FlightSchema>[] = [];
  for (const input of data.flights) {
    const parsed = FlightResultSchema.safeParse(input);
    if (!parsed.success) { warnings.push("A flight with incomplete times, prices or fare details was excluded."); continue; }
    const f = parsed.data;
    const inbound = f.inbound_segments;
    if (f.outbound_segments[0].departure_airport !== homeAirport ||
      f.outbound_departure.slice(0, 10) !== journey.departure_date ||
      Date.parse(f.outbound_arrival) > Date.parse(meeting.start) ||
      !inWindow(f.outbound_departure, journey.departure_window) || !inWindow(f.outbound_arrival, journey.arrival_window) ||
      (journey.max_stops !== null && f.outbound_stops > journey.max_stops)) continue;
    if (journey.one_way && f.is_round_trip) continue;
    if (!journey.one_way && (!f.is_round_trip || !f.inbound_departure || !f.inbound_arrival || !f.inbound_duration_min || !inbound?.length ||
      f.inbound_departure.slice(0, 10) !== journey.return_date || Date.parse(f.inbound_departure) < Date.parse(meeting.end) ||
      inbound.at(-1)?.arrival_airport !== homeAirport ||
      (journey.max_stops !== null && inbound.length - 1 > journey.max_stops))) continue;
    const segments = (items: z.infer<typeof SegmentSchema>[]) => items.map((s) => ({
      origin: s.departure_airport, destination: s.arrival_airport, departure: utc(s.departure_time), arrival: utc(s.arrival_time),
      flight_number: s.flight_number, carrier: s.airline, operating_carrier: s.operating_carrier ?? null,
    }));
    for (const fare of f.fares) {
      if ((journey.cabin && fare.cabin_class !== journey.cabin) || (journey.refundable_only && fare.refundable !== true) ||
        (journey.checked_bag_included && fare.checked_bag_included !== true)) continue;
      const price = Math.round(fare.total_price * 100) / 100;
      const details = FlightDetailsSchema.parse({
        token: fare.trip_item_token, name: f.outbound_airline + " · " + fare.brand_name,
        expires_at: fare.expires_at ?? null, refundable: fare.refundable,
        cancellation_terms: fare.refundable === null ? null : { price_eur: price, refundable: fare.refundable, free_until: null, fee_eur: fare.refundable ? null : price },
        checked_bag_included: fare.checked_bag_included,
        outbound: { origin: f.outbound_segments[0].departure_airport, destination: f.outbound_segments.at(-1)!.arrival_airport,
          departure: utc(f.outbound_departure), arrival: utc(f.outbound_arrival), duration_minutes: f.outbound_duration_min,
          stops: f.outbound_stops, carrier: f.outbound_airline, segments: segments(f.outbound_segments) },
        inbound: !journey.one_way && inbound?.length ? { origin: inbound[0].departure_airport, destination: inbound.at(-1)!.arrival_airport,
          departure: utc(f.inbound_departure!), arrival: utc(f.inbound_arrival!), duration_minutes: f.inbound_duration_min!,
          stops: inbound.length - 1, carrier: f.inbound_airline ?? inbound[0].airline, segments: segments(inbound) } : null,
      });
      flights.push(FlightSchema.parse({ departure: details.outbound.departure, arrival: details.outbound.arrival,
        duration_minutes: f.outbound_duration_min, cabin: fare.cabin_class, price_eur: price, details }));
    }
  }
  return { flights, warnings: [...new Set(warnings)] };
}
const TaxSchema = z.object({ amount: z.number().nonnegative(), currency: z.string(), included: z.boolean(), description: z.string().default("Tax") });
const RateSchema = z.object({
  offer_id: z.string().min(1), total_amount: z.number().nonnegative(), currency: z.literal("EUR"),
  board_name: z.string().default(""), is_refundable: z.boolean().nullable().default(null),
  free_cancellation_until: TimestampSchema.optional(), taxes_breakdown: TaxSchema.array(),
});
const HotelResultSchema = z.object({
  hotel_id: z.string(), name: z.string(), address: z.string().default(""), city: z.string().default(""),
  rooms: z.array(z.object({ room_name: z.string().default(""), requested_occupancy: z.number().optional(), rates: z.array(z.unknown()) })),
});
export function parseHotels(raw: unknown, journey: Journey, timezone: string) {
  const data = z.object({ hotels: z.array(z.unknown()), warnings: z.string().array().optional() }).parse(toolData(raw));
  const warnings = [...(data.warnings ?? [])];
  const nights = (Date.parse(journey.hotel_checkout!) - Date.parse(journey.hotel_checkin!)) / 86400000;
  const hotels: z.infer<typeof HotelSchema>[] = [];
  for (const input of data.hotels) {
    const hotel = HotelResultSchema.safeParse(input);
    if (!hotel.success) { warnings.push("An incomplete hotel result was excluded."); continue; }
    const h = hotel.data;
    for (const room of h.rooms) {
      if (room.requested_occupancy !== undefined && room.requested_occupancy !== 1) continue;
      for (const inputRate of room.rates) {
        const parsed = RateSchema.safeParse(inputRate);
        if (!parsed.success) { warnings.push("A hotel rate with an unsupported currency or incomplete taxes was excluded."); continue; }
        const rate = parsed.data;
        const extras = rate.taxes_breakdown.filter((t) => !t.included);
        if (extras.some((t) => t.currency !== "EUR")) { warnings.push("A rate with taxes in another currency was excluded."); continue; }
        const total = (Math.round(rate.total_amount * 100) + extras.reduce((sum, t) => sum + Math.round(t.amount * 100), 0)) / 100;
        const details = HotelDetailsSchema.parse({
          token: rate.offer_id, name: h.name, hotel_id: h.hotel_id, address: [h.address, h.city].filter(Boolean).join(", "),
          expires_at: null, refundable: rate.is_refundable, checkin: journey.hotel_checkin, checkout: journey.hotel_checkout,
          timezone, room: room.room_name || "Room", board: rate.board_name, total_eur: total,
          extra_taxes: extras.map((t) => t.description + ": EUR " + t.amount.toFixed(2) + " (included in our estimate)"),
          cancellation_terms: rate.is_refundable === null ? null : { price_eur: total, refundable: rate.is_refundable,
            free_until: rate.free_cancellation_until ?? null, fee_eur: rate.is_refundable ? null : total },
        });
        hotels.push(HotelSchema.parse({ nights, nightly_eur: total / nights, total_eur: total, details }));
      }
    }
  }
  return { hotels, warnings: [...new Set(warnings)] };
}

export const CartSchema = z.object({ trip_id: z.string().min(1) }).passthrough();
export const CheckoutSchema = z.object({
  checkout_url: z.string().url().refine((s) => new URL(s).protocol === "https:", "Expected a secure payment URL"),
  expires_at: TimestampSchema.optional(), total_amount: z.unknown().optional(),
  status: z.string().optional(),
}).passthrough();
