import { z } from "zod";
import { ExpenseSchema, IdSchema, TimestampSchema, MoneySchema } from "./domain";
export const ExpenseCategorySchema = z.enum(["hotel", "flight", "meals", "ground_transport", "other"]);
export const ReceiptExtractionSchema = z.object({
  is_receipt: z.boolean(), issues: z.string().array(),
  lines: z.array(z.object({
    date: z.string().nullable(), merchant: z.string().nullable(), category: ExpenseCategorySchema,
    amount: MoneySchema.nullable(), currency: z.string().nullable(), nights: z.number().int().positive().nullable(),
    note: z.string().nullable(), confidence: z.number().min(0).max(1),
  })),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;
export const ReceiptSchema = z.object({
  id: IdSchema, owner_id: IdSchema, trip_id: IdSchema, traveler_id: IdSchema,
  path: z.string(), file_name: z.string(), mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  content_hash: z.string(), status: z.enum(["uploading", "uploaded", "extracting", "needs_review", "ready", "failed", "ignored"]),
  extraction: ReceiptExtractionSchema.nullable(), error: z.string().nullable(), created_at: TimestampSchema,
});
export type Receipt = z.infer<typeof ReceiptSchema>;
export const ExpenseInputSchema = z.object({
  receipt_id: IdSchema, line_index: z.number().int().min(0).max(49), date: z.string().date(),
  merchant: z.string().trim().min(1).max(200), category: ExpenseCategorySchema,
  amount: MoneySchema.max(1000000), currency: z.string().regex(/^[A-Z]{3}$/),
  amount_eur: MoneySchema.max(1000000), nights: z.number().int().positive().max(365).nullable(),
  note: z.string().trim().max(2000).nullable(), reviewed: z.literal(true),
}).strict()
  .refine((v) => v.currency !== "EUR" || v.amount === v.amount_eur, "EUR amounts must match.")
  .refine((v) => v.currency === "EUR" || (v.note?.length ?? 0) >= 5, "Record the source of the EUR conversion in the note.")
  .refine((v) => v.category !== "hotel" || v.nights !== null, "Enter the number of hotel nights.");
export type ExpenseInput = z.infer<typeof ExpenseInputSchema>;

// Readable subset of the immutable report payload; the stored snapshot also includes policy and receipt hashes.
export const ExpenseReportSnapshotSchema = z.object({
  expenses: ExpenseSchema.array(),
  travelers: z.object({ id: IdSchema, name: z.string() }).array(),
  totals: z.object({ total_eur: MoneySchema, per_traveler: z.record(MoneySchema), unconverted: z.number().int().nonnegative() }),
});
