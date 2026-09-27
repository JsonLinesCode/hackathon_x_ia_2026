import { AvailabilitySchema, FlightDetailsSchema, type ReplyClassification, type PlanTraveler, type TripOption } from "@repo/types";
export function replyStatus(reply: ReplyClassification) {
  return reply.confidence >= 0.8 && ["confirmed", "declined", "counter_proposal"].includes(reply.classification)
    ? reply.classification as "confirmed" | "declined" | "counter_proposal" : "needs_review" as const;
}
export function canRemind(lastSent: string | null, now: Date) {
  return !lastSent || now.getTime() - Date.parse(lastSent) >= 2 * 60 * 60 * 1000;
}
export function calendarConflicts(item: TripOption["per_traveler"][number], person: PlanTraveler) {
  const availability = AvailabilitySchema.safeParse(person.availability);
  if (!availability.success || availability.data.source === "unknown" || !item.flight) return [];
  const flight = FlightDetailsSchema.parse(item.flight.details);
  return [flight.outbound, flight.inbound].filter((leg) => leg !== null).flatMap((leg) =>
    availability.data.busy.filter((busy) => Date.parse(busy.start) < Date.parse(leg!.arrival) && Date.parse(busy.end) > Date.parse(leg!.departure)));
}
export function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
