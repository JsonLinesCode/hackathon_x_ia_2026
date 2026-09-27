import { z } from "zod";

export const FieldSourceSchema = z.enum(["Stated", "Profile", "Policy", "Default", "Edited", "Missing"]);
export type FieldSource = z.infer<typeof FieldSourceSchema>;
const sourced = <T extends z.ZodTypeAny>(value: T) => z.object({ value, source: FieldSourceSchema, reference: z.string().nullable().default(null) });
export const PartOfDaySchema = z.enum(["morning", "midday", "afternoon", "evening"]);
export const JourneyMomentSchema = z.object({ date: z.string().date(), part: PartOfDaySchema });
export type JourneyMoment = z.infer<typeof JourneyMomentSchema>;
export const RelativeJourneySchema = z.object({
  date: z.string().date().nullable(), weekday: z.number().int().min(0).max(6).nullable(),
  relative_day: z.number().int().min(-30).max(30).nullable(), part: PartOfDaySchema.nullable(), relative_to: z.literal("meeting"),
});
export const DraftTimeWindowSchema = z.object({ earliest: z.string().nullable(), latest: z.string().nullable() });
export const DraftFieldSchema = z.enum(["travelers", "add_traveler", "remove_traveler", "destination", "meeting_date", "meeting_start", "meeting_end", "meeting_duration", "venue", "outbound", "return", "hotel_nights", "budget", "cabin", "hotel_cap", "max_stops", "departure_window", "arrival_window", "refundable_only", "checked_bag_included", "constraint", "remove_constraint", "note", "remove_note"]);
export type DraftField = z.infer<typeof DraftFieldSchema>;
export const DraftChangeSchema = z.object({
  field: DraftFieldSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), RelativeJourneySchema, DraftTimeWindowSchema.extend({ relative_to: z.literal("local_time") }), z.null()]),
  traveler_id: z.string().uuid().nullable(),
});
export type DraftChange = z.infer<typeof DraftChangeSchema>;
export const DraftIntentSchema = z.object({
  intent: z.enum(["edit", "clarify", "note", "validate", "other"]),
  language: z.enum(["fr", "en"]), changes: DraftChangeSchema.array().max(40), confidence: z.number().min(0).max(1),
  clarification: z.object({ question: z.string(), options: z.array(z.string()).min(2).max(4) }).nullable(),
});
export type DraftIntent = z.infer<typeof DraftIntentSchema>;
export const TripCardSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), language: z.enum(["fr", "en"]),
  travelers: sourced(z.array(z.string().uuid()).max(12)),
  destination: sourced(z.string().nullable()), meeting_date: sourced(z.string().date().nullable()),
  meeting_start: sourced(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()),
  meeting_end: sourced(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()),
  venue: sourced(z.string().nullable()), timezone: sourced(z.string().nullable()),
  outbound: sourced(JourneyMomentSchema.nullable()), return: sourced(JourneyMomentSchema.nullable()),
  hotel_nights: sourced(z.number().int().min(0).max(60).nullable()),
  budget: sourced(z.number().positive().nullable()), cabin: sourced(z.enum(["economy", "premium_economy", "business", "first"])),
  max_stops: sourced(z.number().int().min(0).max(2).nullable()).default({ value: null, source: "Default", reference: null }),
  refundable_only: sourced(z.boolean()).default({ value: false, source: "Default", reference: null }),
  checked_bag_included: sourced(z.boolean()).default({ value: false, source: "Default", reference: null }),
  departure_window: sourced(DraftTimeWindowSchema.nullable()).default({ value: null, source: "Default", reference: null }),
  arrival_window: sourced(DraftTimeWindowSchema.nullable()).default({ value: null, source: "Default", reference: null }),
  hotel_cap: sourced(z.number().positive()),
  class_rule: sourced(z.string()), arrival_margin: sourced(z.number()),
  transport: sourced(z.record(z.enum(["flight", "none"]))), round_trip: sourced(z.literal(true)),
  overrides: z.object({ outbound: z.boolean(), return: z.boolean() }),
  constraints: z.array(sourced(z.string())), notes: z.array(sourced(z.string())),
  validated_at: z.string().nullable(),
});
export type TripCard = z.infer<typeof TripCardSchema>;
export const TripMessageSchema = z.object({
  id: z.string().uuid(), trip_id: z.string().uuid(), owner_id: z.string().uuid(),
  role: z.enum(["user", "agent", "system"]), content: z.string(), quick_replies: z.string().array(), created_at: z.string(),
});
export type TripMessage = z.infer<typeof TripMessageSchema>;
export const DraftMessageInputSchema = z.object({ content: z.string().trim().min(1).max(12000), idempotency_key: z.string().uuid(), revision: z.number().int().nonnegative() }).strict();
export const CardEditInputSchema = z.object({ changes: DraftChangeSchema.array().min(1).max(20), idempotency_key: z.string().uuid(), revision: z.number().int().nonnegative() }).strict();
