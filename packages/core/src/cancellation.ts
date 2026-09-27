import { CancellationTermsSchema, type CancellationTerms } from "@repo/types";

export function computeCancellationCost(input: CancellationTerms | null, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid cancellation date");
  if (input === null) return { feeEur: null, refundable: null, deadline: null, requiresReview: true };
  const terms = CancellationTermsSchema.parse(input);
  const beforeDeadline = terms.free_until !== null && now.getTime() < Date.parse(terms.free_until);
  if (beforeDeadline) return { feeEur: 0, refundable: true, deadline: terms.free_until, requiresReview: false };
  if (!terms.refundable) {
    return { feeEur: terms.price_eur, refundable: false, deadline: terms.free_until, requiresReview: false };
  }
  if (terms.fee_eur === null) return { feeEur: null, refundable: null, deadline: terms.free_until, requiresReview: true };
  return {
    feeEur: terms.fee_eur, refundable: terms.fee_eur < terms.price_eur,
    deadline: terms.free_until, requiresReview: false,
  };
}
