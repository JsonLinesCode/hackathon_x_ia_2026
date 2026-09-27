import { describe, it, expect } from "vitest";
import { cancellationTotal, isLate } from "./disruptions";
import type { CancellationPreview } from "@repo/types";
describe("recovery decisions", () => {
  it("keeps unknown fees unknown and sums known customer penalties", () => {
    expect(cancellationTotal([{ fee_eur: 12.25 }, { fee_eur: 3.5 }] as CancellationPreview[])).toBe(15.75);
    expect(cancellationTotal([{ fee_eur: 0 }, { fee_eur: null }] as CancellationPreview[])).toBeNull();
  });
  it("compares UTC instants for late arrival across offsets", () => {
    expect(isLate("2026-11-10T12:00:00+01:00", "2026-11-10T10:00:00Z")).toBe(true);
    expect(isLate(null, "2026-11-10T10:00:00Z")).toBe(false);
    expect(isLate("2026-11-10T11:00:00+01:00", "2026-11-10T10:00:00Z")).toBe(false);
  });
});
