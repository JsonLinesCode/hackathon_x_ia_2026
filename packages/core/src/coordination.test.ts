import { describe, expect, it } from "vitest";
import { canRemind, replyStatus } from "./coordination";
describe("traveler reply decisions", () => {
  it("applies only confident, actionable classes", () => {
    for (const classification of ["confirmed", "declined", "counter_proposal"] as const) {
      expect(replyStatus({ classification, confidence: 0.8, constraints: [], explanation: "" })).toBe(classification);
      expect(replyStatus({ classification, confidence: 0.799, constraints: [], explanation: "" })).toBe("needs_review");
    }
    expect(replyStatus({ classification: "question", confidence: 1, constraints: [], explanation: "" })).toBe("needs_review");
  });
  it("enforces the two-hour reminder boundary", () => {
    expect(canRemind("2026-01-01T10:00:00Z", new Date("2026-01-01T11:59:59Z"))).toBe(false);
    expect(canRemind("2026-01-01T10:00:00Z", new Date("2026-01-01T12:00:00Z"))).toBe(true);
  });
});
