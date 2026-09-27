import type { Expense, PolicyRules, Trip } from "@repo/types";

export function assessExpense(expense: Expense, policy: PolicyRules, trip: Trip, all: Expense[]) {
  const reasons: string[] = [];
  if (expense.amount_eur === null) reasons.push("Verify the EUR conversion before reporting.");
  if (expense.category === "hotel") {
    if (!expense.nights) reasons.push("Hotel nights must be verified.");
    else if (expense.amount_eur !== null && expense.amount_eur / expense.nights > policy.hotel_cap_eur)
      reasons.push("Hotel exceeds EUR " + policy.hotel_cap_eur + " per person per night.");
  }
  if (expense.category === "other") reasons.push("Check the business purpose of this expense.");
  if (expense.category === "flight") {
    reasons.push("Check flight class against the travel policy using the ticket.");
  }
  if (all.some((e) => e.id !== expense.id && e.traveler_id === expense.traveler_id && e.date === expense.date &&
    e.merchant.trim().toLowerCase() === expense.merchant.trim().toLowerCase() && e.amount === expense.amount && e.currency === expense.currency))
    reasons.push("Possible duplicate receipt: verify before submitting.");
  const cap = Math.min(policy.max_trip_budget_per_traveler ?? Infinity, trip.budget_per_traveler ?? Infinity);
  const total = all.filter((e) => e.traveler_id === expense.traveler_id).reduce((sum, e) => sum + Math.round((e.amount_eur ?? 0) * 100), 0) / 100;
  if (total > cap) reasons.push("Traveler expenses exceed the EUR " + cap + " trip budget.");
  return { compliant: reasons.length === 0, reasons };
}
export function expenseTotals(expenses: Expense[]) {
  const people: Record<string, number> = {};
  for (const e of expenses) people[e.traveler_id] = (people[e.traveler_id] ?? 0) + Math.round((e.amount_eur ?? 0) * 100);
  return { total_eur: Object.values(people).reduce((a, b) => a + b, 0) / 100,
    per_traveler: Object.fromEntries(Object.entries(people).map(([id, cents]) => [id, cents / 100])),
    unconverted: expenses.filter((e) => e.amount_eur === null).length };
}
export function expenseCsv(expenses: Expense[], names: Record<string, string>) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [["Traveler", "Date", "Merchant", "Category", "Amount", "Currency", "EUR amount", "Verified", "Compliant", "Policy review", "Note"],
    ...expenses.map((e) => [names[e.traveler_id] ?? e.traveler_id, e.date, e.merchant, e.category, e.amount, e.currency, e.amount_eur, e.reviewed, e.compliant, e.policy_reasons.join("; "), e.note])]
    .map((row) => row.map(cell).join(",")).join("\r\n");
}
