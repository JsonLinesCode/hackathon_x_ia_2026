import { TripStatusSchema, type TripStatus } from "@repo/types";

// This is a graph, not an ordinal list: missing information, exceptions,
// disruption recovery, and Phase 2's availability shortcut are explicit.
const transitions: Record<TripStatus, readonly TripStatus[]> = {
  draft: ["understanding", "cancelled"],
  understanding: ["disrupted", "needs_info", "checking_availability", "searching", "cancelled"],
  needs_info: ["disrupted", "understanding", "cancelled"],
  checking_availability: ["disrupted", "needs_info", "searching", "cancelled"],
  searching: ["disrupted", "needs_info", "options_ready", "cancelled"],
  options_ready: ["disrupted", "awaiting_exception", "awaiting_travelers", "searching", "cancelled"],
  awaiting_exception: ["disrupted", "awaiting_travelers", "options_ready", "cancelled"],
  awaiting_travelers: ["disrupted", "ready_to_book", "searching", "options_ready", "cancelled"],
  ready_to_book: ["disrupted", "booking", "options_ready", "cancelled"],
  booking: ["booked", "disrupted", "options_ready"], // Restart is allowed only before any provider mutation (server guard).
  booked: ["disrupted", "completed"],
  disrupted: ["understanding", "needs_info", "checking_availability", "searching", "options_ready", "awaiting_exception", "awaiting_travelers", "ready_to_book", "booking", "booked", "cancelled"],
  cancelled: ["reported"],
  completed: ["reported"],
  reported: [],
};
export function canTransition(from: TripStatus, to: TripStatus) {
  return transitions[TripStatusSchema.parse(from)].includes(TripStatusSchema.parse(to));
}
export function transitionTrip(from: TripStatus, to: TripStatus): TripStatus {
  if (!canTransition(from, to)) throw new Error("Invalid trip transition: " + from + " → " + to);
  return to;
}
