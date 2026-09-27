import { z } from "zod";
import { IdSchema, MoneySchema, TimestampSchema, TimeZoneSchema, TripSchema, TripOptionSchema, TripTravelerSchema, TravelerRecordSchema, BookingSchema, ActionSchema, TimelineEventSchema, FlightSchema, HotelSchema } from "./domain";

export const CabinSchema = z.enum(["economy", "premium_economy", "business", "first"]);
export const TimeWindowSchema = z.object({ earliest: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(), latest: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable() });
export const JourneySchema = z.object({
  transport: z.enum(["flight", "none"]).nullable(),
  destination_iata: z.string().regex(/^[A-Z]{3}$/).nullable(),
  departure_date: z.string().date().nullable(), return_date: z.string().date().nullable(),
  one_way: z.boolean().nullable(), hotel_needed: z.boolean().nullable(),
  hotel_checkin: z.string().date().nullable(), hotel_checkout: z.string().date().nullable(),
  hotel_query: z.string().nullable(),
  cabin: CabinSchema.nullable(), max_stops: z.number().int().min(0).max(2).nullable(),
  refundable_only: z.boolean(), checked_bag_included: z.boolean(),
  departure_window: TimeWindowSchema.nullable(), arrival_window: TimeWindowSchema.nullable(),
  unsupported_constraints: z.array(z.string()),
});
export type Journey = z.infer<typeof JourneySchema>;

// Every field is required (nullable when absent) for OpenAI strict structured outputs.
// Date phrases are resolved in core, against an explicit clock, after extraction.
export const RequestExtractionSchema = z.object({
  title: z.string().nullable(), destination: z.string().nullable(), language: z.enum(["fr", "en"]),
  travelers: z.array(z.object({
    name: z.string(), email: z.string().nullable(), home_city: z.string().nullable(), home_airport: z.string().nullable(),
  })),
  meeting: z.object({
    title: z.string(), date: z.string().nullable(), end_date: z.string().nullable(),
    start_time: z.string().nullable(), end_time: z.string().nullable(),
    timezone: z.string(), location: z.string(),
  }).nullable(),
  budget_per_traveler: MoneySchema.nullable(), total_budget: MoneySchema.nullable(),
  journey: JourneySchema.extend({
    departure_date: z.string().nullable(), return_date: z.string().nullable(),
    hotel_checkin: z.string().nullable(), hotel_checkout: z.string().nullable(),
  }),
  constraints: z.array(z.string()), missingFields: z.array(z.string()),
});
export type RequestExtraction = z.infer<typeof RequestExtractionSchema>;
export const BookingDetailsSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  passenger_type: z.literal("ADULT"),
  date_of_birth: z.string().date().nullable(),
  gender: z.enum(["MALE", "FEMALE"]).nullable(),
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Include the country code, e.g. +33612345678"),
  no_extras: z.literal(true),
}).strict();
export type BookingDetails = z.infer<typeof BookingDetailsSchema>;
export const PlanTravelerSchema = TripTravelerSchema.extend({
  booking_details: BookingDetailsSchema.nullable().default(null), traveler: TravelerRecordSchema,
});
export type PlanTraveler = z.infer<typeof PlanTravelerSchema>;
export const SearchResultSchema = z.object({
  flights: FlightSchema.array(), hotels: HotelSchema.array(), warnings: z.string().array(),
  raw: z.record(z.unknown()), searched_at: TimestampSchema,
});
export type SearchResult = z.infer<typeof SearchResultSchema>;
export const PlanningStateSchema = z.object({
  traveler_ids: IdSchema.array().default([]),
  journey: JourneySchema.nullable().default(null),
  searches: z.record(SearchResultSchema).default({}),
  error: z.string().nullable().default(null),
  attempt: z.number().int().nonnegative().default(0),
}).default({});
export type PlanningState = z.infer<typeof PlanningStateSchema>;
export const TripDetailSchema = z.object({
  trip: TripSchema,
  journey: JourneySchema.nullable(),
  travelers: PlanTravelerSchema.array(),
  options: TripOptionSchema.array(),
  bookings: BookingSchema.omit({ raw: true }).array(),
  actions: ActionSchema.array(),
  timeline: TimelineEventSchema.array(),
  workflow_error: z.string().nullable(),
  running: z.boolean(),
});
export type TripDetail = z.infer<typeof TripDetailSchema>;
export const CreateTripSchema = z.object({
  request_text: z.string().trim().min(10).max(12000),
  traveler_ids: IdSchema.array().max(12).default([]),
  idempotency_key: IdSchema,
}).strict();
export const OfferMetadataSchema = z.object({
  token: z.string().min(1), name: z.string(),
  expires_at: TimestampSchema.nullable(), refundable: z.boolean().nullable(),
  cancellation_terms: z.object({
    price_eur: MoneySchema, refundable: z.boolean(), free_until: TimestampSchema.nullable(), fee_eur: MoneySchema.nullable(),
  }).nullable(),
});
export const FlightLegViewSchema = z.object({
  origin: z.string(), destination: z.string(), departure: TimestampSchema, arrival: TimestampSchema,
  duration_minutes: z.number().positive(), stops: z.number().int().nonnegative(),
  carrier: z.string(), segments: z.array(z.object({
    origin: z.string(), destination: z.string(), departure: TimestampSchema, arrival: TimestampSchema,
    flight_number: z.string(), carrier: z.string(), operating_carrier: z.string().nullable(),
  })),
});
export const FlightDetailsSchema = OfferMetadataSchema.extend({
  outbound: FlightLegViewSchema, inbound: FlightLegViewSchema.nullable(), checked_bag_included: z.boolean().nullable(),
});
export const HotelDetailsSchema = OfferMetadataSchema.extend({
  hotel_id: z.string(), address: z.string(), checkin: z.string().date(), checkout: z.string().date(),
  timezone: TimeZoneSchema, room: z.string(), board: z.string(), total_eur: MoneySchema,
  extra_taxes: z.string().array(),
});
