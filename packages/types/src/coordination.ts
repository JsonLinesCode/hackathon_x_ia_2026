import { z } from "zod";
import { IdSchema, TimestampSchema } from "./domain";
export const BusyWindowSchema = z.object({ start: TimestampSchema, end: TimestampSchema });
export const AvailabilitySchema = z.object({
  checked_at: TimestampSchema, source: z.enum(["direct", "consented", "unknown"]),
  busy: BusyWindowSchema.array(), reason: z.string().nullable(),
});
export const ReplyClassificationSchema = z.object({
  classification: z.enum(["confirmed", "counter_proposal", "declined", "question", "unclear"]),
  confidence: z.number().min(0).max(1), constraints: z.string().array(), explanation: z.string(),
});
export type ReplyClassification = z.infer<typeof ReplyClassificationSchema>;
export const EmailDraftSchema = z.object({ subject: z.string(), body: z.string() });
export const TravelerReplySchema = z.object({
  decision: z.enum(["confirmed", "counter_proposal", "declined"]),
  message: z.string().trim().max(4000).default(""),
}).strict().refine((v) => v.decision !== "counter_proposal" || v.message.length >= 5, "Describe the alternative dates or constraints.");
export const OutreachMetadataSchema = z.object({
  option_id: IdSchema.nullable().default(null),
  subject: z.string().default(""), message_id: z.string().default(""),
  expires_at: TimestampSchema.nullable().default(null),
}).passthrough();
