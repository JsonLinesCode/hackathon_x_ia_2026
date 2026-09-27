import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, PolicyRulesSchema, TravelerInputSchema, type TravelOption } from "@repo/types";
import { classifyAction, assertActionExecutable } from "./gate";
import { evaluatePolicy } from "./policy";
import { computeCancellationCost } from "./cancellation";
import { rankOptions } from "./scoring";
import { canTransition, transitionTrip } from "./state-machine";
import { resolveRelativeDate, zonedDateTimeToUtc } from "./dates";
import { signLink, verifyLink } from "./signed-link";

const travelerId = "cc02a830-3634-4c56-99f5-6614b20246c7";
const option: TravelOption = {
  id: "balanced", meeting_start: "2026-10-13T16:00:00Z",
  per_traveler: [{
    traveler_id: travelerId,
    flight: { departure: "2026-10-13T10:00:00Z", arrival: "2026-10-13T12:00:00Z", duration_minutes: 120, cabin: "economy", price_eur: 240 },
    hotel: { nights: 2, nightly_eur: 150 },
  }],
};
const copy = () => structuredClone(option);

describe("action gate", () => {
  it.each(["send_information", "request_confirmation", "send_reminder", "calendar_invite", "calendar_update", "send_recap"])("allows verified free reversible %s", (kind) => {
    expect(classifyAction({ kind, cost_eur: 0, reversible: true })).toBe("auto");
  });
  it.each(["book", "cancel_booking", "modify_booking", "submit_expense_report", "pay", "unknown"])("requires a manager for %s, even with no advertised cost", (kind) => {
    expect(classifyAction({ kind, cost_eur: 0, reversible: true })).toBe("needs_manager");
  });
  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, "0", 0.01])("fails closed on cost %s", (cost_eur) => {
    expect(classifyAction({ kind: "send_reminder", cost_eur, reversible: true })).toBe("needs_manager");
  });
  it("blocks irreversible actions and incomplete input", () => {
    expect(classifyAction({ kind: "calendar_invite", cost_eur: 0, reversible: false })).toBe("needs_manager");
    expect(classifyAction({})).toBe("needs_manager");
  });
  it("requires a recorded decision and rejects re-execution", () => {
    const booking = { kind: "book" as const, cost_eur: 100, reversible: false, status: "proposed" as const, decided_at: null };
    expect(() => assertActionExecutable(booking)).toThrow(/approval/);
    expect(() => assertActionExecutable({ ...booking, status: "approved" })).toThrow(/approval/);
    expect(() => assertActionExecutable({ ...booking, status: "approved", decided_at: "2026-09-27T10:00:00Z" })).not.toThrow();
    expect(() => assertActionExecutable({ ...booking, status: "executed", decided_at: "2026-09-27T10:00:00Z" })).toThrow();
  });
});

describe("policy and ranking", () => {
  it("accepts a compliant option without changing it", () => {
    const before = copy();
    expect(evaluatePolicy(option, DEFAULT_POLICY)).toEqual({ compliant: true, violations: [] });
    expect(option).toEqual(before);
  });
  it("evaluates the per-traveler total including every hotel night", () => {
    expect(evaluatePolicy(option, { ...DEFAULT_POLICY, max_trip_budget_per_traveler: 539 }).violations[0].code).toBe("budget");
    expect(evaluatePolicy(option, { ...DEFAULT_POLICY, max_trip_budget_per_traveler: 540 }).compliant).toBe(true);
  });
  it("reports class, hotel, budget, and arrival violations independently", () => {
    const value = copy();
    value.per_traveler[0].flight!.cabin = "business";
    value.per_traveler[0].hotel!.nightly_eur = 181;
    value.per_traveler[0].flight!.arrival = "2026-10-13T15:01:00Z";
    const result = evaluatePolicy(value, { ...DEFAULT_POLICY, max_trip_budget_per_traveler: 300 });
    expect(result.violations.map((v) => v.code)).toEqual(["flight_class", "hotel_cap", "budget", "arrival_margin"]);
  });
  it("accepts exact thresholds and compares absolute instants", () => {
    const value = copy();
    value.per_traveler[0].flight!.cabin = "business";
    value.per_traveler[0].flight!.duration_minutes = 360;
    value.per_traveler[0].hotel!.nightly_eur = 180;
    value.per_traveler[0].flight!.arrival = "2026-10-13T17:00:00+02:00";
    expect(evaluatePolicy(value, DEFAULT_POLICY).compliant).toBe(true);
  });
  it("does not assume an unknown meeting time is compliant", () => {
    expect(evaluatePolicy({ ...copy(), meeting_start: null }, DEFAULT_POLICY).violations[0].code).toBe("missing_meeting");
  });
  it("rejects malformed prices", () => {
    const value = copy(); value.per_traveler[0].flight!.price_eur = -1;
    expect(() => evaluatePolicy(value, DEFAULT_POLICY)).toThrow();
  });
  it("ranks compliance before price, with stable ties", () => {
    const cheap = copy(); cheap.id = "cheap"; cheap.per_traveler[0].flight!.price_eur = 100; cheap.per_traveler[0].flight!.cabin = "first";
    const expensive = copy(); expensive.id = "expensive"; expensive.per_traveler[0].flight!.price_eur = 500;
    const ranked = rankOptions([cheap, expensive, option], DEFAULT_POLICY);
    expect(ranked.map((value) => value.option.id)).toEqual(["balanced", "expensive", "cheap"]);
    expect(ranked[0].totalEur).toBe(540);
    expect(rankOptions([], DEFAULT_POLICY)).toEqual([]);
  });
  it("normalizes traveler input and rejects owner injection", () => {
    const traveler = { full_name: " Alice ", email: "ALICE@example.com", home_city: "Paris", home_airport: " cdg " };
    expect(TravelerInputSchema.parse(traveler)).toMatchObject({ full_name: "Alice", email: "alice@example.com", home_airport: "CDG" });
    expect(TravelerInputSchema.safeParse({ ...traveler, owner_id: travelerId }).success).toBe(false);
    expect(PolicyRulesSchema.safeParse({ hotel_cap_eur: -1 }).success).toBe(false);
  });
});

describe("cancellation costs", () => {
  const terms = { price_eur: 200, refundable: true, free_until: "2026-10-12T12:00:00Z", fee_eur: 50 };
  it("handles the deadline boundary without promising a free cancellation", () => {
    expect(computeCancellationCost(terms, new Date("2026-10-12T11:59:59Z")).feeEur).toBe(0);
    expect(computeCancellationCost(terms, new Date("2026-10-12T12:00:00Z")).feeEur).toBe(50);
  });
  it("keeps non-refundable costs and unknown fees explicit", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    expect(computeCancellationCost({ ...terms, refundable: false }, now)).toMatchObject({ feeEur: 200, refundable: false });
    expect(computeCancellationCost({ ...terms, fee_eur: null }, now)).toMatchObject({ feeEur: null, requiresReview: true });
    expect(computeCancellationCost(null, now).requiresReview).toBe(true);
  });
  it("rejects invalid dates and negative fees", () => {
    expect(() => computeCancellationCost(terms, new Date("invalid"))).toThrow();
    expect(() => computeCancellationCost({ ...terms, fee_eur: -1 }, new Date())).toThrow();
  });
});

describe("trip transitions", () => {
  it("supports missing information, the Phase 2 shortcut and exception review", () => {
    expect(transitionTrip("understanding", "needs_info")).toBe("needs_info");
    expect(canTransition("needs_info", "understanding")).toBe(true);
    expect(canTransition("understanding", "searching")).toBe(true);
    expect(canTransition("options_ready", "awaiting_exception")).toBe(true);
    expect(canTransition("awaiting_exception", "ready_to_book")).toBe(false);
  });
  it("prevents skipping decisions or reviving a terminal report", () => {
    expect(() => transitionTrip("draft", "booked")).toThrow();
    expect(() => transitionTrip("reported", "booking")).toThrow();
    expect(canTransition("disrupted", "booked")).toBe(true);
    expect(canTransition("completed", "reported")).toBe(true);
  });
});

describe("relative dates and time zones", () => {
  it("resolves French and English requests in Paris, including the midnight boundary", () => {
    const now = new Date("2026-09-28T23:30:00Z"); // Already Tuesday in Paris.
    expect(resolveRelativeDate("aujourd'hui", now)).toBe("2026-09-29");
    expect(resolveRelativeDate("mardi", now)).toBe("2026-09-29");
    expect(resolveRelativeDate("next Tuesday", now)).toBe("2026-10-06");
    expect(resolveRelativeDate("mardi prochain", now)).toBe("2026-10-06");
    expect(resolveRelativeDate("demain", now)).toBe("2026-09-30");
    expect(resolveRelativeDate("dans 3 jours", now)).toBe("2026-10-02");
    expect(resolveRelativeDate("today", now, "America/New_York")).toBe("2026-09-28");
  });
  it("handles leap dates, year changes and unsupported language explicitly", () => {
    expect(resolveRelativeDate("tomorrow", new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
    expect(resolveRelativeDate("2028-02-29")).toBe("2028-02-29");
    expect(() => resolveRelativeDate("2026-02-29")).toThrow();
    expect(() => resolveRelativeDate("whenever")).toThrow();
    expect(() => resolveRelativeDate("today", new Date(), "invalid-zone")).toThrow();
  });
  it("converts summer and winter wall times to UTC", () => {
    expect(zonedDateTimeToUtc("2026-07-01", "09:00")).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-12-01", "09:00")).toBe("2026-12-01T08:00:00.000Z");
    expect(zonedDateTimeToUtc("2026-07-01", "09:00", "Asia/Kathmandu")).toBe("2026-07-01T03:15:00.000Z");
  });
  it("rejects nonexistent and ambiguous DST times", () => {
    expect(() => zonedDateTimeToUtc("2026-03-29", "02:30")).toThrow(/does not exist/);
    expect(() => zonedDateTimeToUtc("2026-10-25", "02:30")).toThrow(/Ambiguous/);
    expect(() => zonedDateTimeToUtc("2026-10-01", "25:30")).toThrow();
  });
});

describe("signed links", () => {
  const secret = "test-only-secret-with-at-least-32-characters";
  const now = new Date("2026-09-27T10:00:00Z");
  const payload = { purpose: "trip_confirmation" as const, id: travelerId, exp: Math.floor(now.getTime() / 1000) + 3600 };
  it("round-trips an authenticated, purpose-bound link", async () => {
    const token = await signLink(payload, secret, now);
    await expect(verifyLink(token, "trip_confirmation", secret, now)).resolves.toEqual(payload);
  });
  it("rejects tampering, the wrong purpose and the wrong key", async () => {
    const token = await signLink(payload, secret, now);
    await expect(verifyLink(token.slice(0, -3) + "aaa", "trip_confirmation", secret, now)).rejects.toThrow();
    await expect(verifyLink(token, "calendar_access", secret, now)).rejects.toThrow();
    await expect(verifyLink(token, "trip_confirmation", secret + "-different", now)).rejects.toThrow();
  });
  it("rejects expired, overlong-lived and malformed tokens", async () => {
    const token = await signLink(payload, secret, now);
    await expect(verifyLink(token, "trip_confirmation", secret, new Date(payload.exp * 1000))).rejects.toThrow();
    await expect(signLink({ ...payload, exp: payload.exp + 7 * 86400 }, secret, now)).rejects.toThrow();
    await expect(signLink(payload, "short", now)).rejects.toThrow();
    await expect(verifyLink("not.a.valid.token", "trip_confirmation", secret, now)).rejects.toThrow();
  });
});
