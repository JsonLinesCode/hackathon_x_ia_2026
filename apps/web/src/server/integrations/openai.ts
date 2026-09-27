import { EXTRACT_REQUEST, EXPLAIN_OPTIONS, DRAFT_EMAIL, CLASSIFY_REPLY, CLASSIFY_NOTICE, EXTRACT_RECEIPT } from "../agent/prompts";
import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ReceiptExtractionSchema, RequestExtractionSchema, ReplyClassificationSchema, EmailDraftSchema, NoticeClassificationSchema, type TravelerRecord } from "@repo/types";
import { getEnv } from "../env";
import { IntegrationError, type Audit } from "./errors";

export async function structured<T extends z.ZodTypeAny>(schema: T, name: string, instructions: string, input: unknown, audit: Audit, attachment?: { mime: string; data: string }): Promise<z.infer<T>> {
  const env = getEnv(["OPENAI_API_KEY", "OPENAI_MODEL"]);
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60000, maxRetries: 1 });
  await audit("OpenAI: " + name, "Structured request started.", { model: env.OPENAI_MODEL });
  try {
    const result = await client.responses.parse({
      model: env.OPENAI_MODEL, store: false, instructions, input: attachment ? [{ role: "user", content: [
        { type: "input_text", text: JSON.stringify(input) },
        attachment.mime === "application/pdf"
          ? { type: "input_file", filename: "receipt.pdf", file_data: "data:application/pdf;base64," + attachment.data }
          : { type: "input_image", image_url: "data:" + attachment.mime + ";base64," + attachment.data, detail: "high" },
      ] }] : JSON.stringify(input),
      text: { format: zodTextFormat(schema, name) },
    });
    if (!result.output_parsed) throw new IntegrationError("OpenAI", "NO_OUTPUT", "OpenAI could not produce a complete structured answer. Clarify the request and retry.");
    const parsed = schema.parse(result.output_parsed);
    await audit("OpenAI: " + name + " completed", "Structured output validated.", { model: result.model });
    return parsed;
  } catch (error) {
    const safe = error instanceof IntegrationError ? error : new IntegrationError("OpenAI",
      error instanceof OpenAI.APIError ? String(error.status ?? "API_ERROR") : "INVALID_OUTPUT",
      error instanceof OpenAI.APIError && [401, 403, 404].includes(error.status ?? 0)
        ? "OpenAI rejected the request. Check OPENAI_API_KEY and access to OPENAI_MODEL."
        : "OpenAI did not return a valid answer within the timeout and retry limit. Please retry.");
    await audit("OpenAI call failed", safe.message, { code: safe.code });
    throw safe;
  }
}

export function extractRequest(request: string, travelers: TravelerRecord[], selectedIds: string[], now: Date, audit: Audit) {
  return structured(RequestExtractionSchema, "travel_request",
    EXTRACT_REQUEST,
    { request, current_time: now.toISOString(), reference_timezone: "Europe/Paris",
      selected_traveler_ids: selectedIds, directory: travelers.map((t) => ({ id: t.id, name: t.full_name, email: t.email, home_city: t.home_city, home_airport: t.home_airport, preferences: t.preferences })) }, audit);
}

const ExplanationsSchema = z.object({ explanations: z.array(z.object({ id: z.string(), text: z.string() })) });
export async function explainOptions(options: { id: string; label: string; total_eur: number; compliant: boolean; violations: unknown; per_traveler: unknown }[], language: "fr" | "en", audit: Audit) {
  const result = await structured(ExplanationsSchema, "option_explanations",
    EXPLAIN_OPTIONS,
    { language, options }, audit);
  if (result.explanations.length !== options.length || new Set(result.explanations.map((e) => e.id)).size !== options.length ||
    options.some((o) => !result.explanations.some((e) => e.id === o.id))) {
    await audit("OpenAI explanations rejected", "The returned option IDs did not match.");
    throw new IntegrationError("OpenAI", "OPTION_MISMATCH", "OpenAI explanations did not match the ranked options. Retry this step.");
  }
  return new Map(result.explanations.map((e) => [e.id, e.text]));
}

export function draftEmail(purpose: string, recipient: string, language: "fr" | "en", facts: unknown, audit: Audit) {
  return structured(EmailDraftSchema, "email_draft", DRAFT_EMAIL, { purpose, recipient, language, facts }, audit);
}
export function classifyReply(subject: string, body: string, audit: Audit) {
  return structured(ReplyClassificationSchema, "traveler_reply", CLASSIFY_REPLY, { subject, body }, audit);
}

export function classifyNotice(subject: string, body: string, audit: Audit) {
 return structured(NoticeClassificationSchema, "travel_notice", CLASSIFY_NOTICE, { subject, body }, audit);
}

export function extractReceipt(mime: string, bytes: Buffer, audit: Audit) {
  return structured(ReceiptExtractionSchema, "receipt_expenses",
    EXTRACT_RECEIPT, {}, audit, { mime, data: bytes.toString("base64") });
}
