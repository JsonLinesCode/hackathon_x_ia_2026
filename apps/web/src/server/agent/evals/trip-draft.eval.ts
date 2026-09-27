// Deliberately excluded from pnpm test: these checks call the configured real model.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DEFAULT_POLICY, type TravelerRecord } from "@repo/types";
import { applyDraftChanges, blankTripCard, cardToValidatedPlan, detectedTravelers, draftSummary, draftValidation, interpretDraft } from "@repo/core";
import { interpretTripMessage } from "../draft-interpreter";

const names = ["Alice Martin", "Emma Durand", "Sarah Ruiz", "Josselin Martin"];
const directory: TravelerRecord[] = names.map((full_name, i) => ({ id: `${i + 1}1111111-1111-4111-8111-111111111111`, owner_id: "11111111-1111-4111-8111-111111111111", full_name, email: full_name.split(" ")[0].toLowerCase() + "@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" }));
const now = new Date("2026-09-27T10:00:00Z");
const card = applyDraftChanges(blankTripCard(DEFAULT_POLICY, [directory[0].id, directory[2].id], "fr"), [
  { field: "destination", value: "Berlin", traveler_id: null }, { field: "meeting_date", value: "2026-10-06", traveler_id: null }, { field: "meeting_start", value: "10:00", traveler_id: null },
], directory, "Stated", now);
const cases = [
  { message: "je veux retourner mardi matin", field: "return", expected: { date: "2026-10-06", part: "morning" } },
  { message: "finalement la réunion est à 14h", field: "meeting_start", expected: "14:00" },
  { message: "ajoute Emma", field: "travelers", expected: directory.slice(0, 3).map((p) => p.id).sort() },
  { message: "retire Sarah", field: "travelers", expected: [directory[0].id] },
  { message: "rentrer le lendemain soir", field: "return", expected: { date: "2026-10-07", part: "evening" } },
  { message: "je veux retrouner mardi matin", field: "return", expected: { date: "2026-10-06", part: "morning" } },
  { message: "partir la veille après-midi", field: "outbound", expected: { date: "2026-10-05", part: "afternoon" } },
] as const;
describe("real-model French trip draft interpretation", () => {
  it.each(cases)("$message", async ({ message, field, expected }) => {
    const intent = await interpretTripMessage(message, card, directory, [], async () => undefined, now);
    expect(intent.intent).toBe("edit"); expect(intent.confidence).toBeGreaterThanOrEqual(.85); expect(intent.language).toBe("fr");
    const result = interpretDraft(card, intent, message, directory, now).card;
    const actual = result[field].value;
    expect(Array.isArray(actual) ? [...actual].sort() : actual).toEqual(expected);
    expect(result.notes).toEqual([]);
  }, 90000);
  it("silently ignores a vague optional edit without a question or note", async () => {
    const text = "je veux changer le retour";
    const intent = await interpretTripMessage(text, card, directory, [], async () => undefined, now);
    expect(intent.changes).toEqual([]); expect(intent.clarification).toBeNull();
    const result = interpretDraft(card, intent, text, directory, now).card;
    expect(result.return).toEqual(card.return); expect(result.notes).toEqual([]);
  }, 90000);
});


describe("messy jury requests against the real model", () => {
  const requests = [
    { message: "josselin berlin réunion 6 octobre 10h, réunion de 2h, retour à paris, en train si possible, il est végétarien", date: "2026-10-06", start: "10:00", end: "12:00", language: "fr" },
    { message: "Organize a trip for Josselin to Berlin next Tuesday at 10am", date: "2026-09-29", start: "10:00", end: "12:00", language: "en" },
    { message: "organise deplacement josselin a berlin le 6/10 a 10h30 pas de vol avant 7h", date: "2026-10-06", start: "10:30", end: "12:30", language: "fr" },
  ];
  it.each(requests)("$message", async ({ message, date, start, end, language }) => {
    const initial = blankTripCard(DEFAULT_POLICY, detectedTravelers(message, directory));
    const intent = await interpretTripMessage(message, initial, directory, [], async () => undefined, now);
    expect(intent.intent).toBe("edit"); expect(intent.confidence).toBeGreaterThanOrEqual(.85);
    expect(intent.clarification).toBeNull(); expect(intent.language).toBe(language);
    const result = interpretDraft(initial, intent, message, directory, now, true).card;
    expect(result.travelers.value).toEqual([directory[3].id]); expect(result.destination.value).toBe("Berlin");
    expect(result.meeting_date.value).toBe(date); expect(result.meeting_start.value).toBe(start); expect(result.meeting_end.value).toBe(end);
    expect(result.constraints).toEqual([]); expect(result.notes).toEqual([]);
    expect(draftValidation(result)).toMatchObject({ canValidate: true, missing: [], question: "" });
    expect(draftSummary(initial, result, directory)).not.toMatch(/\?|clarif|warning|train|végétarien/i);
    if (message.includes("réunion de 2h")) expect(intent.changes).toContainEqual({ field: "meeting_duration", value: 120, traveler_id: null });
    const plan = cardToValidatedPlan(result, directory);
    expect(plan.journey.one_way).toBe(false); expect(plan.journey.unsupported_constraints).toEqual([]);
    if (message.includes("avant 7h")) expect(plan.journey.departure_window?.earliest).toBe("07:00");
  }, 90000);
});
