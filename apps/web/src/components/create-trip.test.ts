import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_POLICY, type TravelerRecord } from "@repo/types";
import { applyDraftChanges, blankTripCard } from "@repo/core";
import { LiveTripCard } from "./create-trip";
const id = "11111111-1111-4111-8111-111111111111";
const person: TravelerRecord = { id, owner_id: id, full_name: "Josselin Martin", email: "josselin@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" };
describe("Validate and search UI guard", () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))("only disables for the four essentials (mask %i)", (mask) => {
    const card = applyDraftChanges(blankTripCard(DEFAULT_POLICY, [id]), [
      { field: "destination", value: "Berlin", traveler_id: null }, { field: "meeting_date", value: "2026-10-06", traveler_id: null }, { field: "meeting_start", value: "10:00", traveler_id: null },
    ], [person], "Stated");
    if (mask & 1) card.travelers.value = [];
    if (mask & 2) card.destination.value = null;
    if (mask & 4) card.meeting_date.value = null;
    if (mask & 8) card.meeting_start.value = null;
    card.constraints.push({ value: "UNSUPPORTED_TRAIN_DIET_HOTEL", source: "Stated", reference: null });
    const html = renderToStaticMarkup(createElement(LiveTripCard, { card, people: [person], busy: false, changed: [], edit: vi.fn(), validate: vi.fn() }));
    const button = html.match(/<button[^>]*class="[^"]*draft-validate[^>]*>/)?.[0];
    expect(button).toBeDefined(); expect(button).toContain(`aria-disabled="${Boolean(mask)}"`);
    expect(button).not.toMatch(/\sdisabled=/);
    expect(html).not.toContain("UNSUPPORTED_TRAIN_DIET_HOTEL");
    expect(html).not.toContain("Review required");
  });
});
