import { z } from "zod";
import { IdSchema, TimestampSchema, TripStatusSchema, MoneySchema, TripOptionSchema } from "./domain";
export const DisruptionKindSchema = z.enum(["meeting_cancelled", "meeting_moved", "flight_cancelled", "flight_delayed"]);
export const DisruptionEventSchema = z.object({
  kind: DisruptionKindSchema, trip_id: IdSchema, booking_id: IdSchema.nullable().default(null),
  detail: z.string().max(8000).default(""), new_start: TimestampSchema.nullable().default(null),
  new_end: TimestampSchema.nullable().default(null), new_arrival: TimestampSchema.nullable().default(null),
});
export type DisruptionEvent = z.infer<typeof DisruptionEventSchema>;
export const ProviderMoneySchema = z.object({ value: z.number().int().nonnegative(), currency: z.literal("EUR"), decimal_places: z.number().int().min(0).max(4) });
export const CancellationPreviewSchema = z.object({
  booking_id: IdSchema, kind: z.enum(["flight", "hotel"]), mode: z.enum(["provider", "manual"]),
  booking_ref: z.string().nullable(), item_id: z.number().int().positive().nullable(),
  quote: z.string().nullable(), refund: ProviderMoneySchema.nullable(), fee_eur: MoneySchema.nullable(),
  expires_at: TimestampSchema.nullable(), instruction: z.string(),
});
export type CancellationPreview = z.infer<typeof CancellationPreviewSchema>;
export const DisruptionStateSchema = z.object({
  id: IdSchema, event: DisruptionEventSchema, previous_status: TripStatusSchema,
  stage: z.enum(["alerting", "checking", "previewing", "proposing", "waiting", "resolving", "resolved"]),
  previews: z.record(CancellationPreviewSchema).default({}),
  other_events: z.array(z.object({ title: z.string(), at: z.string(), calendar: z.string() })).default([]),
  calendars_checked: z.string().array().default([]), calendar_unknown: z.string().array().default([]),
  replacement_options: TripOptionSchema.array().default([]),
  action_ids: IdSchema.array().default([]), chosen_action: IdSchema.nullable().default(null),
  resolution: z.string().nullable().default(null),
});
export type DisruptionState = z.infer<typeof DisruptionStateSchema>;
export const NoticeClassificationSchema = z.object({
  kind: z.enum(["meeting_cancelled", "meeting_moved", "flight_cancelled", "flight_delayed", "unrelated"]),
  confidence: z.number().min(0).max(1), booking_ref: z.string().nullable(), meeting_event_id: z.string().nullable(),
  new_start: z.string().nullable(), new_end: z.string().nullable(), new_arrival: z.string().nullable(), detail: z.string(),
});
export const SimulationInputSchema = z.object({
  owner_email: z.string().email().optional(), idempotency_key: z.string().min(8).max(160),
  kind: z.enum(["meeting_cancelled", "meeting_moved", "flight_cancelled", "flight_delayed", "inbound_email"]),
  trip_id: IdSchema, booking_id: IdSchema.nullable().default(null),
  detail: z.string().max(8000).default(""), new_start: TimestampSchema.nullable().default(null),
  new_end: TimestampSchema.nullable().default(null), new_arrival: TimestampSchema.nullable().default(null),
  subject: z.string().max(1000).default(""), body: z.string().max(16000).default(""),
}).strict();
