// Deliberately excluded from pnpm test: these checks call the configured real model.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DEFAULT_POLICY, type TravelerRecord } from "@repo/types";
import { applyDraftChanges, blankTripCard, interpretDraft } from "@repo/core";
import { interpretTripMessage } from "../draft-interpreter";

const names = ["Alice Martin", "Emma Durand", "Sarah Ruiz"];
const directory: TravelerRecord[] = names.map((full_name, i) => ({ id: `${i + 1}1111111-1111-4111-8111-111111111111`, owner_id: "11111111-1111-4111-8111-111111111111", full_name, email: full_name.split(" ")[0].toLowerCase() + "@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" }));
const now = new Date("2026-09-27T10:00:00Z");
const card = applyDraftChanges(blankTripCard(DEFAULT_POLICY, [directory[0].id, directory[2].id], "fr"), [
  { field: "destination", value: "Berlin", traveler_id: null }, { field: "meeting_date", value: "2026-10-06", traveler_id: null }, { field: "meeting_start", value: "10:00", traveler_id: null },
], directory, "Stated", now);
const cases = [
  { message: "je veux retourner mardi matin", field: "return", expected: { date: "2026-10-06", part: "morning" } },
  { message: "finalement la réunion est à 14h", field: "meeting_start", expected: "14:00" },
  { message: "ajoute Emma", field: "travelers", expected: directory.map((p) => p.id).sort() },
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
  it("asks one question instead of inventing a change or silently adding a note", async () => {
    const text = "je veux changer le retour";
    const intent = await interpretTripMessage(text, card, directory, [], async () => undefined, now);
    expect(intent.intent).toBe("clarify"); expect(intent.confidence).toBeLessThan(.85);
    expect(intent.clarification?.options.length).toBeGreaterThanOrEqual(2);
    expect(intent.clarification?.options.length).toBeLessThanOrEqual(4);
    const result = interpretDraft(card, intent, text, directory, now).card;
    expect(result.return).toEqual(card.return); expect(result.notes).toEqual([]);
  }, 90000);
});
