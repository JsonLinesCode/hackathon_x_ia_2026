import "server-only";
import { resolveRequest } from "@repo/core";
import { extractRequest } from "../../integrations/openai";
import { HttpError } from "../../http";
import type { TripStore } from "../store";
export async function replanTraveler(store: TripStore, travelerId: string, constraint?: string) {
  if (store.state.trip.status !== "awaiting_travelers" || store.state.bookings.length) throw new HttpError(409, "A quote has started. Resolve the existing booking before replanning.");
  const person = store.state.travelers.find((t) => t.traveler_id === travelerId);
  const selected = store.state.options.find((o) => o.selected);
  if (!person || !selected) throw new HttpError(404, "Traveler plan not found.");
  const reply = constraint ?? person.response_text;
  if (!reply) throw new HttpError(400, "Supply the traveler's alternative dates or constraints.");
  const prompt = "Update this trip ONLY for " + person.traveler.full_name + ". Preserve the meeting and other stated requirements unless explicitly changed. " +
    "Original request: " + store.state.trip.request_text + "\nTraveler counter-proposal: " + reply +
    "\nThis run is only for the selected traveler. Ignore other people mentioned in the original request.";
  const extraction = await extractRequest(prompt, [person.traveler], [travelerId], new Date(), store.audit);
  const resolved = resolveRequest(extraction, [person.traveler], [travelerId], new Date());
  if (resolved.request.missingFields.length || !resolved.journey ||
      resolved.request.meeting?.start !== store.state.trip.meeting?.start || resolved.request.meeting?.end !== store.state.trip.meeting?.end) {
    await store.save({ travelers: [{ traveler_id: travelerId, confirmation_status: "needs_review",
      response_text: reply + "\n" + (resolved.request.missingFields.join(" ") || "Meeting changes affect the group and need a revised request.") }],
      events: [{ title: "Counter-proposal needs review", detail: person.traveler.full_name }] });
    return;
  }
  const searches = { ...store.state.workflow.searches };
  delete searches[travelerId];
  // Freeze the other travelers' selected offers; only this traveler is searched.
  for (const item of selected.per_traveler.filter((p) => p.traveler_id !== travelerId)) {
    searches[item.traveler_id] = { ...searches[item.traveler_id], flights: item.flight ? [item.flight] : [], hotels: item.hotel ? [item.hotel] : [] };
  }
  await store.save({ reset_plan: true,
    travelers: store.state.travelers.map((t) => ({ traveler_id: t.traveler_id, confirmation_status: t.traveler_id === travelerId ? "not_requested" : t.confirmation_status,
      response_text: t.response_text, booking_details: t.booking_details, availability: t.availability })),
    trip: { status: store.next("searching"), workflow: { ...store.state.workflow, searches, error: null,
      coordination: { ...store.state.workflow.coordination, replan_traveler: travelerId,
        traveler_journeys: { ...store.state.workflow.coordination.traveler_journeys, [travelerId]: resolved.journey } } } },
    events: [{ title: "Traveler alternatives requested", detail: person.traveler.full_name + ": " + reply }] });
}
