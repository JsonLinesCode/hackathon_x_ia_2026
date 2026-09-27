import { describe, it, expect } from "vitest";
import { DEFAULT_POLICY, ExpenseInputSchema, ExpenseSchema, type Trip } from "@repo/types";
import { assessExpense, expenseTotals, expenseCsv } from "./expenses";
const id = "11111111-1111-4111-8111-111111111111";
const trip = { budget_per_traveler: 500 } as Trip;
const expense = (extra = {}) => ExpenseSchema.parse({ id, owner_id: id, trip_id: id, traveler_id: id,
  date: "2026-09-20", merchant: "Hotel", category: "hotel", amount: 360, currency: "EUR",
  amount_eur: 360, nights: 2, compliant: false, note: null, receipt_path: null, ...extra });
describe("expense policy and totals", () => {
  it("applies the nightly hotel cap and per-traveler total deterministically", () => {
    const hotel = expense();
    expect(assessExpense(hotel, DEFAULT_POLICY, trip, [hotel]).compliant).toBe(true);
    const other = expense({ id: "22222222-2222-4222-8222-222222222222", category: "meals", amount: 200, amount_eur: 200 });
    expect(assessExpense(hotel, DEFAULT_POLICY, trip, [hotel, other]).reasons).toContain("Traveler expenses exceed the EUR 500 trip budget.");
    expect(assessExpense(expense({ nights: 1 }), DEFAULT_POLICY, trip, [hotel]).compliant).toBe(false);
  });
  it("does not invent FX conversions and warns about duplicate expenses", () => {
    const foreign = expense({ currency: "USD", amount_eur: null });
    expect(expenseTotals([foreign])).toMatchObject({ total_eur: 0, unconverted: 1 });
    expect(assessExpense(foreign, DEFAULT_POLICY, trip, [foreign]).compliant).toBe(false);
    const a = expense(), b = expense({ id: "22222222-2222-4222-8222-222222222222" });
    expect(assessExpense(a, DEFAULT_POLICY, trip, [a, b]).reasons.join()).toContain("duplicate");
    expect(expenseTotals([expense({ amount_eur: 0.1 }), expense({ amount_eur: 0.2 })]).total_eur).toBe(0.3);
  });
  it("requires matching EUR figures, nights and conversion evidence", () => {
    const input = { receipt_id: id, line_index: 0, date: "2026-09-20", merchant: "Hotel", category: "hotel", amount: 12,
      currency: "EUR", amount_eur: 12, nights: 1, note: null, reviewed: true };
    expect(ExpenseInputSchema.safeParse(input).success).toBe(true);
    expect(ExpenseInputSchema.safeParse({ ...input, currency: "USD" }).success).toBe(false);
    expect(ExpenseInputSchema.safeParse({ ...input, amount_eur: 13 }).success).toBe(false);
    expect(ExpenseInputSchema.safeParse({ ...input, nights: null }).success).toBe(false);
  });
  it("escapes CSV values and formula-like text", () => {
    const csv = expenseCsv([expense({ merchant: '=HYPERLINK("evil")', note: "+formula" })], { [id]: "Alice, Martin" });
    expect(csv).toContain('"Alice, Martin"');
    expect(csv).toContain("\"'=HYPERLINK(\"\"evil\"\")\"");
    expect(csv).toContain("\"'+formula\"");
  });
});
