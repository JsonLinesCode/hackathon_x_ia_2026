import { FlightDetailsSchema, PolicyRulesSchema, TravelOptionSchema, type PolicyRules, type PolicyViolation, type TravelOption } from "@repo/types";

export function travelerCost(item: TravelOption["per_traveler"][number]) {
  return (Math.round((item.flight?.price_eur ?? 0) * 100)
    + Math.round((item.hotel?.total_eur ?? (item.hotel?.nightly_eur ?? 0) * (item.hotel?.nights ?? 0)) * 100)) / 100;
}

export function evaluatePolicy(input: TravelOption, rules: PolicyRules) {
  const option = TravelOptionSchema.parse(input);
  const policy = PolicyRulesSchema.parse(rules);
  const violations: PolicyViolation[] = [];
  for (const traveler of option.per_traveler) {
    const add = (code: PolicyViolation["code"], message: string) =>
      violations.push({ code, traveler_id: traveler.traveler_id, message });
    const { flight, hotel } = traveler;
    const returnDuration = flight ? FlightDetailsSchema.safeParse(flight.details).data?.inbound?.duration_minutes : undefined;
    if (flight && Math.min(flight.duration_minutes, returnDuration ?? Infinity) < policy.economy_under_hours * 60 && flight.cabin !== "economy") {
      add("flight_class", "Flights under " + policy.economy_under_hours + " hours must be in economy.");
    }
    if (hotel && hotel.nightly_eur > policy.hotel_cap_eur) {
      add("hotel_cap", "Hotel exceeds the EUR " + policy.hotel_cap_eur + " cap per person per night.");
    }
    if (policy.max_trip_budget_per_traveler !== null && travelerCost(traveler) > policy.max_trip_budget_per_traveler) {
      add("budget", "This traveler's total exceeds the per-traveler budget.");
    }
    if (flight) {
      if (!option.meeting_start) add("missing_meeting", "The meeting time is needed to check the arrival margin.");
      else if ((Date.parse(option.meeting_start) - Date.parse(flight.arrival)) / 60000 < policy.arrival_margin_minutes) {
        add("arrival_margin", "Arrival must be at least " + policy.arrival_margin_minutes + " minutes before the meeting.");
      }
    }
  }
  return { compliant: violations.length === 0, violations };
}
