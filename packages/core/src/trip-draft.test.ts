import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type DraftChange, type DraftIntent, type TravelerRecord } from "@repo/types";
import { applyDraftChanges, blankTripCard, cardToValidatedPlan, detectedTravelers, draftIssues, draftSearchConstraints, filterDraftReturnFlights, interpretDraft, requiredDraftFields, resolveJourneyMoment, selectedDraftTravelers } from "./trip-draft";

const id = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const directory: TravelerRecord[] = [{ id, owner_id: id, full_name: "Alice Martin", email: "alice@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" }];
const now = new Date("2026-09-27T10:00:00Z");
const change = (field: DraftChange["field"], value: DraftChange["value"]): DraftChange => ({ field, value, traveler_id: null });
const relative = (values: Partial<{ date: string | null; weekday: number | null; relative_day: number | null; part: "morning" | "midday" | "afternoon" | "evening" | null }>) => ({ date: null, weekday: null, relative_day: null, part: null, relative_to: "meeting" as const, ...values });
function ready(start = "10:00") {
  return applyDraftChanges(blankTripCard(DEFAULT_POLICY, [id]), [change("destination", "Berlin"), change("meeting_date", "2026-10-06"), change("meeting_start", start)], directory, "Stated", now);
}
describe("trip draft defaults and recomputation", () => {
  it("requires people, city, meeting date and start, leaving dependent values empty", () => {
    const card = blankTripCard(DEFAULT_POLICY);
    expect(requiredDraftFields(card)).toEqual(["travelers", "destination", "meeting_date", "meeting_start"]);
    expect(card.outbound.value).toBeNull(); expect(card.meeting_end.value).toBeNull();
  });
  it("builds the morning meeting defaults with auditable sources", () => {
    const card = ready();
    expect(requiredDraftFields(card)).toEqual([]);
    expect(card.meeting_end).toMatchObject({ value: "12:00", source: "Default" });
    expect(card.venue.value).toBe("Berlin city centre"); expect(card.timezone.value).toBe("Europe/Berlin");
    expect(card.outbound.value).toEqual({ date: "2026-10-05", part: "evening" });
    expect(card.return.value).toEqual({ date: "2026-10-06", part: "evening" });
    expect(card.hotel_nights.value).toBe(1); expect(card.transport.value[id]).toBe("flight");
    expect(card.hotel_cap.source).toBe("Policy"); expect(card.hotel_cap.value).toBe(180);
  });
  it("recomputes end and non-overridden journeys when start changes", () => {
    const card = applyDraftChanges(ready(), [change("meeting_start", "14:00")], directory, "Edited", now);
    expect(card.meeting_end.value).toBe("16:00");
    expect(card.outbound.value).toEqual({ date: "2026-10-06", part: "morning" });
    expect(card.return.value).toEqual({ date: "2026-10-07", part: "morning" });
  });
  it("preserves a stated end and an overridden return on start changes", () => {
    const prior = applyDraftChanges(ready(), [change("meeting_end", "17:00"), change("return", relative({ relative_day: 2, part: "evening" }))], directory, "Edited", now);
    const card = applyDraftChanges(prior, [change("meeting_start", "14:00")], directory, "Edited", now);
    expect(card.meeting_end.value).toBe("17:00"); expect(card.return.value).toEqual({ date: "2026-10-08", part: "evening" });
    expect(card.return.source).toBe("Edited"); expect(card.hotel_nights.value).toBe(2);
  });
  it("resets both journey overrides when the meeting date changes", () => {
    const prior = applyDraftChanges(ready(), [change("outbound", relative({ relative_day: -2 })), change("return", relative({ relative_day: 3 }))], directory, "Edited", now);
    const card = applyDraftChanges(prior, [change("meeting_date", "2026-10-10")], directory, "Edited", now);
    expect(card.overrides).toEqual({ outbound: false, return: false });
    expect(card.outbound.value?.date).toBe("2026-10-09"); expect(card.return.value?.date).toBe("2026-10-10");
    expect(card.outbound.source).toBe("Default"); expect(card.return.source).toBe("Default");
  });
  it("applies an explicit journey in the same message after a meeting-date reset", () => {
    const card = applyDraftChanges(ready(), [change("return", relative({ relative_day: 2, part: "evening" })), change("meeting_date", "2026-10-10")], directory, "Edited", now);
    expect(card.return.value).toEqual({ date: "2026-10-12", part: "evening" });
  });
  it("resolves relative dates in the new destination time zone regardless of change order", () => {
    const card = applyDraftChanges(ready(), [change("meeting_date", "tomorrow"), change("destination", "New York")], directory, "Edited", new Date("2026-10-06T00:30:00Z"));
    expect(card.meeting_date.value).toBe("2026-10-06");
    expect(card.timezone.value).toBe("America/New_York");
  });
  it("keeps hotel nights consistent when edited by moving the return", () => {
    const card = applyDraftChanges(ready(), [change("hotel_nights", 2)], directory, "Edited", now);
    expect(card.return.value?.date).toBe("2026-10-07"); expect(card.hotel_nights.value).toBe(2);
  });
  it("derives no flight for a local traveler and handles meetings ending the next day", () => {
    const card = applyDraftChanges(ready("23:00"), [change("destination", "Paris")], directory, "Edited", now);
    expect(card.transport.value[id]).toBe("none"); expect(card.meeting_end.value).toBe("01:00");
    expect(card.return.value?.date).toBe("2026-10-07");
  });
});
describe("journey dates resolved against the meeting", () => {
  it.each([
    ["return", { weekday: 2, part: "morning" }, "2026-10-06"],
    ["return", { weekday: 1, part: "morning" }, "2026-10-12"],
    ["outbound", { weekday: 3, part: "afternoon" }, "2026-09-30"],
    ["outbound", { relative_day: -1, part: "afternoon" }, "2026-10-05"],
    ["return", { relative_day: 1, part: "evening" }, "2026-10-07"],
    ["return", { relative_day: 0, part: "evening" }, "2026-10-06"],
  ] as const)("resolves %s %j to %s", (direction, value, expected) => {
    expect(resolveJourneyMoment(relative(value), "2026-10-06", direction, null).date).toBe(expected);
  });
  it("rejects conflicting journey date selectors instead of silently choosing one", () => {
    expect(() => resolveJourneyMoment(relative({ weekday: 2, relative_day: 1 }), "2026-10-06", "return", null)).toThrow(/Choose one/);
  });
  it("cannot resolve a relative journey without a meeting date", () => {
    expect(() => resolveJourneyMoment(relative({ relative_day: 1 }), null, "return", null)).toThrow(/meeting date/);
  });
});
describe("selection and safe interpretation", () => {
  it("detects whole names, not substrings, with manual exclusions taking priority", () => {
    expect(detectedTravelers("Alice vient", directory)).toEqual([id]);
    expect(detectedTravelers("Malice", directory)).toEqual([]);
    expect(selectedDraftTravelers("Alice Martin vient", directory, { [id]: false })).toEqual([]);
    expect(selectedDraftTravelers("Berlin", directory, { [id]: true })).toEqual([id]);
  });
  it("does not auto-select ambiguous first names", () => {
    expect(detectedTravelers("Alice", [...directory, { ...directory[0], id: second, full_name: "Alice Dupont" }])).toEqual([]);
  });
  it("rejects foreign traveler IDs atomically", () => {
    expect(() => applyDraftChanges(ready(), [change("destination", "Rome"), change("add_traveler", second)], directory, "Edited")).toThrow(/workspace/);
    expect(ready().destination.value).toBe("Berlin");
  });
  it("does not apply a low-confidence edit or silently create a note", () => {
    const intent: DraftIntent = { language: "fr", intent: "edit", changes: [change("meeting_start", "14:00")], confidence: .6, clarification: null };
    expect(interpretDraft(ready(), intent, "je veux changer", directory).card.meeting_start.value).toBe("10:00");
    const note = { ...intent, intent: "note" as const, confidence: .99, changes: [change("note", "changer le retour")] };
    expect(interpretDraft(ready(), note, "je veux changer le retour", directory).card.notes).toEqual([]);
    expect(interpretDraft(ready(), note, "Ajoute une note : changer le retour", directory).card.notes).toHaveLength(1);
  });
  it("does not launch or mutate the card for a validate intent", () => {
    const intent: DraftIntent = { language: "fr", intent: "validate", changes: [], confidence: 1, clarification: null };
    expect(interpretDraft(ready(), intent, "valide", directory).card.validated_at).toBeNull();
  });
  it("rejects conflicting dates on validation and never searches an incomplete card", () => {
    expect(() => cardToValidatedPlan(blankTripCard(DEFAULT_POLICY), directory, now)).toThrow(/required/);
    const card = applyDraftChanges(ready(), [change("return", relative({ relative_day: -1 }))], directory, "Edited");
    expect(draftIssues(card)).not.toEqual([]); expect(() => cardToValidatedPlan(card, directory, now)).toThrow(/Return/);
  });
  it("requests clarification for ambiguous local times instead of failing validation unexpectedly", () => {
    const card = applyDraftChanges(ready(), [change("meeting_date", "2026-10-25"), change("meeting_start", "02:30")], directory, "Edited", now);
    expect(() => cardToValidatedPlan(card, directory, now)).toThrow(/ambiguous.*destination time zone/);
  });
  it("builds the existing availability workflow without calendar meeting lookup", () => {
    const plan = cardToValidatedPlan(ready(), directory, now);
    expect(plan.workflow.coordination.meeting_checked).toBe(true); expect(plan.meeting.google_event_id).toBeNull();
    expect(plan.meeting.start).toBe("2026-10-06T08:00:00.000Z"); expect(plan.workflow.searches).toEqual({});
    expect(plan.journey.one_way).toBe(false); expect(plan.journey.departure_window).toEqual({ earliest: "18:00", latest: "23:59" });
  });
});

describe("validated draft constraints", () => {
  it("turns supported constraints into existing search filters and blocks unsupported requirements", () => {
    const direct = applyDraftChanges(ready(), [change("constraint", "Vol direct"), change("constraint", "Bagage en soute inclus")], directory, "Stated");
    expect(draftSearchConstraints(direct)).toMatchObject({ max_stops: 0, checked_bag_included: true, unsupported: [] });
    expect(cardToValidatedPlan(direct, directory, now).journey.max_stops).toBe(0);
    const unsupported = applyDraftChanges(direct, [change("constraint", "Train uniquement")], directory, "Edited");
    expect(() => cardToValidatedPlan(unsupported, directory, now)).toThrow(/Train uniquement/);
  });
  it("checks the selected return period in the destination time zone without changing provider data", () => {
    const flights = [
      { details: { inbound: { departure: "2026-10-06T17:00:00Z" } } },
      { details: { inbound: { departure: "2026-10-06T12:00:00Z" } } },
      { details: { inbound: { departure: "2026-10-07T17:00:00Z" } } },
    ];
    expect(filterDraftReturnFlights(flights, ready(), "Europe/Berlin")).toEqual([flights[0]]);
    expect(flights).toHaveLength(3);
  });
});
