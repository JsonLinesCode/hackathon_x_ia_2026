import { FlightDetailsSchema, PolicyRulesSchema, TravelOptionSchema, type PolicyRules, type TravelOption } from "@repo/types";
import { evaluatePolicy, travelerCost } from "./policy";

// Compliance always precedes optimization. Lower score wins; ties are stable by id.
export function rankOptions(inputs: TravelOption[], rules: PolicyRules) {
  const policy = PolicyRulesSchema.parse(rules);
  const options = inputs.map((input) => {
    const option = TravelOptionSchema.parse(input);
    const totalEur = Math.round(option.per_traveler.reduce((sum, item) => sum + travelerCost(item), 0) * 100) / 100;
    const duration = option.per_traveler.reduce((sum, item) => sum + (item.flight?.duration_minutes ?? 0) + (item.flight ? FlightDetailsSchema.safeParse(item.flight.details).data?.inbound?.duration_minutes ?? 0 : 0), 0);
    const marginPenalty = option.per_traveler.reduce((sum, item) => {
      if (!item.flight) return sum;
      if (!option.meeting_start) return sum + 1;
      const margin = (Date.parse(option.meeting_start) - Date.parse(item.flight.arrival)) / 60000;
      return sum + Math.max(0, policy.arrival_margin_minutes - margin) / Math.max(1, policy.arrival_margin_minutes);
    }, 0);
    return { option, totalEur, duration, marginPenalty, ...evaluatePolicy(option, policy) };
  });
  const maxCost = Math.max(1, ...options.map((item) => item.totalEur));
  const maxDuration = Math.max(1, ...options.map((item) => item.duration));
  return options.map((item) => ({
    ...item, score: 0.5 * item.totalEur / maxCost + 0.25 * item.duration / maxDuration + 0.25 * item.marginPenalty,
  })).sort((a, b) => Number(b.compliant) - Number(a.compliant) || a.score - b.score || a.option.id.localeCompare(b.option.id))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}
