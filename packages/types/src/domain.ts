import { z } from "zod";

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const MoneySchema = z.number().finite().nonnegative();
export const TimeZoneSchema = z.string().refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; }
  catch { return false; }
}, "Use an IANA time zone, such as Europe/Paris");
export const PreferencesSchema = z.object({
  seat: z.enum(["aisle", "window", "none"]).default("none"),
  notes: z.string().trim().max(2000).default(""),
});
export const TravelerInputSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  home_city: z.string().trim().min(1).max(120),
  home_airport: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Enter a three-letter IATA airport code"),
  preferences: PreferencesSchema.default({}),
}).strict();
export const CalendarAccessSchema = z.enum(["unknown", "direct", "consented", "denied"]);
export const TravelerRecordSchema = TravelerInputSchema.extend({
  id: IdSchema, owner_id: IdSchema, calendar_access: CalendarAccessSchema, created_at: TimestampSchema,
});
export type TravelerRecord = z.infer<typeof TravelerRecordSchema>;
export type TravelerInput = z.infer<typeof TravelerInputSchema>;

export const PolicyRulesSchema = z.object({
  economy_under_hours: z.number().finite().positive().max(24).default(6),
  hotel_cap_eur: z.number().finite().positive().max(10000).default(180),
  max_trip_budget_per_traveler: z.number().finite().positive().max(1000000).nullable().default(null),
  arrival_margin_minutes: z.number().int().min(0).max(1440).default(60),
}).strict();
export type PolicyRules = z.infer<typeof PolicyRulesSchema>;
export const DEFAULT_POLICY: PolicyRules = PolicyRulesSchema.parse({});
export const PolicySchema = z.object({ owner_id: IdSchema, rules: PolicyRulesSchema });
export const ProfileSchema = z.object({
  id: IdSchema, email: z.string().email(), full_name: z.string(), created_at: TimestampSchema,
});

export const TripStatusSchema = z.enum([
  "draft", "understanding", "needs_info", "checking_availability", "searching", "options_ready",
  "awaiting_exception", "awaiting_travelers", "ready_to_book", "booking", "booked", "disrupted",
  "cancelled", "completed", "reported",
]);
export type TripStatus = z.infer<typeof TripStatusSchema>;
export const MeetingSchema = z.object({
  title: z.string().min(1), start: TimestampSchema, end: TimestampSchema,
  timezone: TimeZoneSchema.default("Europe/Paris"), location: z.string(),
  google_event_id: z.string().nullable().default(null),
}).refine((meeting) => Date.parse(meeting.end) > Date.parse(meeting.start), {
  message: "Meeting end must follow its start", path: ["end"],
});
export const TravelRequestSchema = z.object({
  title: z.string().nullable(), destination: z.string().nullable(),
  travelers: z.array(z.object({ name: z.string(), email: z.string().email().nullable() })),
  meeting: MeetingSchema.nullable(), budget_per_traveler: MoneySchema.nullable(),
  language: z.enum(["fr", "en"]), constraints: z.array(z.string()), missingFields: z.array(z.string()),
});
export type TravelRequest = z.infer<typeof TravelRequestSchema>;
export const TripSchema = z.object({
  id: IdSchema, owner_id: IdSchema, title: z.string(), request_text: z.string(),
  extracted: TravelRequestSchema.nullable(), destination: z.string().nullable(), meeting: MeetingSchema.nullable(),
  status: TripStatusSchema, budget_per_traveler: MoneySchema.nullable(),
  created_at: TimestampSchema, updated_at: TimestampSchema,
});
export type Trip = z.infer<typeof TripSchema>;
export const ConfirmationStatusSchema = z.enum(["not_requested", "pending", "confirmed", "counter_proposal", "declined", "needs_review"]);
export const TripTravelerSchema = z.object({
  owner_id: IdSchema, trip_id: IdSchema, traveler_id: IdSchema,
  availability: z.record(z.unknown()).nullable(), confirmation_status: ConfirmationStatusSchema,
  response_text: z.string().nullable(),
});

export const FlightSchema = z.object({
  departure: TimestampSchema, arrival: TimestampSchema, duration_minutes: z.number().int().positive(),
  cabin: z.enum(["economy", "premium_economy", "business", "first"]), price_eur: MoneySchema,
  details: z.record(z.unknown()).optional(),
}).refine((flight) => Date.parse(flight.arrival) > Date.parse(flight.departure), "Flight must arrive after departure");
export const HotelSchema = z.object({ nights: z.number().int().positive(), nightly_eur: MoneySchema, total_eur: MoneySchema.optional(), details: z.record(z.unknown()).optional() });
export const TravelerOptionSchema = z.object({
  traveler_id: IdSchema, flight: FlightSchema.nullable(), hotel: HotelSchema.nullable(),
});
export const PolicyViolationSchema = z.object({
  code: z.enum(["flight_class", "hotel_cap", "budget", "arrival_margin", "missing_meeting"]),
  traveler_id: IdSchema.nullable(), message: z.string(),
});
export type PolicyViolation = z.infer<typeof PolicyViolationSchema>;
export const TravelOptionSchema = z.object({
  id: z.string().min(1), per_traveler: z.array(TravelerOptionSchema).min(1),
  meeting_start: TimestampSchema.nullable(),
}).refine((option) => new Set(option.per_traveler.map((item) => item.traveler_id)).size === option.per_traveler.length,
  "Each traveler must appear only once");
export type TravelOption = z.infer<typeof TravelOptionSchema>;
export const TripOptionSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, label: z.string(), rank: z.number().int(),
  total_eur: MoneySchema, per_traveler: z.array(TravelerOptionSchema), compliant: z.boolean(),
  violations: z.array(PolicyViolationSchema), explanation: z.string(), selected: z.boolean(),
  exception_approved: z.boolean(), exception_note: z.string().nullable(),
});

export const CancellationTermsSchema = z.object({
  price_eur: MoneySchema, refundable: z.boolean(), free_until: TimestampSchema.nullable(), fee_eur: MoneySchema.nullable(),
});
export type CancellationTerms = z.infer<typeof CancellationTermsSchema>;
export const BookingSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, traveler_id: IdSchema,
  kind: z.enum(["flight", "hotel"]), status: z.enum(["quoted", "booked", "cancelled", "cancel_requested", "failed"]),
  provider_ref: z.string().nullable(), price_eur: MoneySchema, payment_link: z.string().url().nullable(),
  cancellation_terms: CancellationTermsSchema.nullable(), details: z.record(z.unknown()), raw: z.record(z.unknown()),
});
export const ActionKindSchema = z.enum([
  "send_information", "request_confirmation", "send_reminder", "calendar_invite", "calendar_update", "send_recap",
  "book", "cancel_booking", "modify_booking", "submit_expense_report",
]);
export const ActionProposalSchema = z.object({
  kind: ActionKindSchema, cost_eur: MoneySchema.nullable(), reversible: z.boolean(),
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export const ActionGateSchema = z.enum(["auto", "needs_manager"]);
export const ActionSchema = ActionProposalSchema.extend({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, summary: z.string(), gate: ActionGateSchema,
  status: z.enum(["proposed", "approved", "rejected", "executing", "executed", "failed"]),
  payload: z.record(z.unknown()), rationale: z.string(), decided_at: TimestampSchema.nullable(),
  result: z.record(z.unknown()).nullable(), idempotency_key: z.string().min(1),
});
export type Action = z.infer<typeof ActionSchema>;
export const OutreachSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, traveler_id: IdSchema,
  purpose: z.enum(["calendar_access", "trip_confirmation", "info_request", "notification"]), channel: z.literal("email"),
  status: z.enum(["sent", "responded", "expired"]), gmail_thread_id: z.string(), gmail_message_id: z.string(),
  sent_at: TimestampSchema, reminder_count: z.number().int().nonnegative(), last_reminder_at: TimestampSchema.nullable(),
});
export const TimelineEventSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, at: TimestampSchema,
  actor: z.enum(["agent", "manager", "traveler", "provider", "system"]), source: z.string(), title: z.string(),
  detail: z.string(), data: z.record(z.unknown()),
});
export const InboundEventSchema = z.object({
  id: IdSchema, owner_id: IdSchema, kind: z.string(), dedupe_key: z.string(),
  payload: z.record(z.unknown()), processed_at: TimestampSchema.nullable(),
});
export const ExpenseSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, traveler_id: IdSchema, date: z.string().date(),
  merchant: z.string(), category: z.string(), amount: MoneySchema, currency: z.string().regex(/^[A-Z]{3}$/),
  amount_eur: MoneySchema, compliant: z.boolean(), note: z.string().nullable(), receipt_path: z.string().nullable(),
});
export const SignedLinkPayloadSchema = z.object({
  purpose: z.enum(["trip_confirmation", "calendar_access", "google_oauth_state"]),
  id: IdSchema, exp: z.number().int().positive(),
}).strict();
export type SignedLinkPayload = z.infer<typeof SignedLinkPayloadSchema>;

export type Profile = z.infer<typeof ProfileSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type TripTraveler = z.infer<typeof TripTravelerSchema>;
export type TripOption = z.infer<typeof TripOptionSchema>;
export type Booking = z.infer<typeof BookingSchema>;
export type Outreach = z.infer<typeof OutreachSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type InboundEvent = z.infer<typeof InboundEventSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
