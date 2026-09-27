import "server-only";
import { randomUUID } from "node:crypto";
import { OutreachSchema, type Outreach, type PlanTraveler, type ReplyClassification } from "@repo/types";
import { canRemind, replyStatus, signLink, itineraryEvents } from "@repo/core";
import { getEnv } from "../../env";
import { HttpError } from "../../http";
import { freeBusy, listEvents, matchMeeting } from "../../integrations/calendar";
import { getMessage, mailHeader } from "../../integrations/gmail";
import { notify, proposal } from "../notify";
import { planningDatabase, type TripStore } from "../store";
import { prepareDecisions } from "./plan-trip";

export function newOutreach(store: TripStore, person: PlanTraveler, purpose: Outreach["purpose"]): Outreach {
  return OutreachSchema.parse({ id: randomUUID(), owner_id: store.owner, trip_id: store.id,
    traveler_id: person.traveler_id, purpose, channel: "email", status: "prepared",
    gmail_message_id: null, gmail_thread_id: null, sent_at: new Date().toISOString(), reminder_count: 0, last_reminder_at: null,
    metadata: { option_id: purpose === "trip_confirmation" ? store.state.options.find((o) => o.selected)?.id : null,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString() } });
}
export async function outreachLink(outreach: Outreach) {
  const env = getEnv(["APP_SECRET", "APP_URL"]);
  const token = await signLink({ id: outreach.id, purpose: outreach.purpose === "calendar_access" ? "calendar_access" : "trip_confirmation",
    exp: Math.floor(Date.parse(String(outreach.metadata.expires_at)) / 1000) }, env.APP_SECRET);
  return env.APP_URL + (outreach.purpose === "calendar_access" ? "/api/google/traveler/start?token=" : "/r/") + token;
}
export async function checkAvailability(store: TripStore) {
  const { trip, workflow } = store.state;
  if (!trip.meeting || !workflow.journey) throw new HttpError(409, "Meeting details are missing.");
  if (!workflow.coordination.meeting_checked) {
    const start = new Date(Date.parse(trip.meeting.start) - 86400000).toISOString();
    const end = new Date(Date.parse(trip.meeting.end) + 86400000).toISOString();
    const events = await listEvents(store.owner, start, end, store.audit);
    const match = matchMeeting(trip.meeting, events);
    await store.save({ trip: { meeting: { ...trip.meeting, google_event_id: match?.id ?? null },
      workflow: { ...workflow, coordination: { ...workflow.coordination, meeting_checked: true, organizer_email: match?.organizer?.email ?? null } } },
      events: [{ title: match ? "Meeting matched in Calendar" : "Meeting not uniquely matched", detail: match ? match.summary : "Using the supplied meeting details. Calendar cancellation monitoring requires a unique matching event." }] });
    return;
  }
  const person = store.state.travelers.find((t) => !t.availability);
  if (!person) {
    await store.save({ trip: { status: store.next("searching") }, events: [{ title: "Availability checked", detail: "Unknown calendars remain explicit; travelers are asked to verify the proposed times." }] });
    return;
  }
  const journey = workflow.coordination.traveler_journeys[person.traveler_id] ?? workflow.journey;
  const start = (journey.departure_date ?? journey.hotel_checkin)! + "T00:00:00Z";
  const end = new Date(Date.parse((journey.return_date ?? journey.hotel_checkout ?? journey.departure_date)! + "T00:00:00Z") + 86400000).toISOString();
  let busy = await freeBusy(store.owner, person.traveler.email, start, end, store.audit);
  let source: "direct" | "consented" | "unknown" = busy ? "direct" : "unknown";
  if (!busy && person.traveler.calendar_access === "consented") {
    try { busy = await freeBusy(store.owner, person.traveler.email, start, end, store.audit, person.traveler_id); if (busy) source = "consented"; }
    catch { await store.event("Traveler calendar needs renewed consent", person.traveler.full_name); }
  }
  if (source !== "unknown") planningDatabase((await store.db.from("travelers").update({ calendar_access: source }).eq("owner_id", store.owner).eq("id", person.traveler_id)).error);
  if (source === "unknown" && !store.state.outreach.some((o) => o.traveler_id === person.traveler_id && o.purpose === "calendar_access" && o.status !== "expired")) {
    const outreach = newOutreach(store, person, "calendar_access");
    await notify(store, { email: person.traveler.email, name: person.traveler.full_name }, {
      key: store.id + ":calendar-consent:" + workflow.attempt + ":" + person.traveler_id, purpose: "Calendar access request",
      facts: { trip: trip.title, request: "Read-only access to check availability. No access to email or ability to change the traveler's calendar." },
      links: [{ label: trip.extracted?.language === "fr" ? "Autoriser l’accès à mon agenda" : "Allow calendar access", url: await outreachLink(outreach) }], outreach,
    });
  }
  await store.save({ travelers: [{ traveler_id: person.traveler_id, availability: { checked_at: new Date().toISOString(), source,
    busy: busy ?? [], reason: source === "unknown" ? "Calendar consent required; verify times manually until granted." : null } }],
    events: [{ title: "Traveler availability saved", detail: person.traveler.full_name + ": " + source }] });

}
export async function confirmationNext(store: TripStore) {
  const option = store.state.options.find((o) => o.selected);
  if (!option || (!option.compliant && !option.exception_approved)) return;
  const person = store.state.travelers.find((t) => t.confirmation_status === "not_requested");
  if (person) {
    const existing = store.state.outreach.find((o) => o.traveler_id === person.traveler_id && o.purpose === "trip_confirmation" && o.metadata.option_id === option.id && o.status !== "expired");
    if (!existing) {
      const outreach = newOutreach(store, person, "trip_confirmation");
      const item = option.per_traveler.find((p) => p.traveler_id === person.traveler_id)!;
      await notify(store, { email: person.traveler.email, name: person.traveler.full_name }, {
        key: store.id + ":confirm:" + option.id + ":" + person.traveler_id, purpose: "Trip confirmation request", kind: "request_confirmation",
        facts: { trip: store.state.trip.title, meeting: store.state.trip.meeting, itinerary: publicItem(item), availability: person.availability,
          instruction: "Ask the traveler to confirm or propose another time. Quotes are not paid. If availability is unknown, explicitly ask them to check their schedule." },
        links: [{ label: store.state.trip.extracted?.language === "fr" ? "Confirmer ou proposer un autre horaire" : "Confirm or propose another time", url: await outreachLink(outreach) }], outreach,
      });
    }
    await store.save({ travelers: [{ traveler_id: person.traveler_id, confirmation_status: "pending" }] });
    return;
  }
  if (store.state.travelers.every((t) => t.confirmation_status === "confirmed" && t.booking_details)) await prepareDecisions(store);
}
export function publicItem(item: { traveler_id: string; flight: unknown; hotel: unknown }) {
  // Opaque provider offer tokens are never sent in traveler emails.
  return JSON.parse(JSON.stringify(item, (key, value) => key === "token" ? undefined : value));
}
export async function applyReply(store: TripStore, outreach: Outreach, input: { decision: "confirmed" | "counter_proposal" | "declined" | "needs_review"; message: string }, actor: "traveler" | "manager", inboundId?: string, receivedAt?: number) {
  const selected = store.state.options.find((o) => o.selected);
  if (store.state.trip.status !== "awaiting_travelers" || selected?.id !== outreach.metadata.option_id || outreach.status === "expired") throw new HttpError(409, "This confirmation belongs to an earlier plan.");
  const person = store.state.travelers.find((t) => t.traveler_id === outreach.traveler_id)!;
  await store.save({ travelers: [{ traveler_id: person.traveler_id, confirmation_status: input.decision, response_text: input.message }],
    outreach: [{ ...outreach, status: "responded", metadata: { ...outreach.metadata, last_reply_at: receivedAt ?? Date.now() } }], inbound_ids: inboundId ? [inboundId] : [],
    events: [{ actor, title: "Traveler response: " + input.decision.replaceAll("_", " "), detail: person.traveler.full_name + ": " + input.message, data: { traveler_id: person.traveler_id, outreach_id: outreach.id } }] });
  if (input.decision === "confirmed" && store.state.travelers.every((t) => t.confirmation_status === "confirmed" && t.booking_details)) await prepareDecisions(store);
}
export async function applyClassifiedReply(store: TripStore, outreach: Outreach, result: ReplyClassification, body: string, inboundId: string, receivedAt?: number) {
  await applyReply(store, outreach, { decision: replyStatus(result), message: body }, "traveler", inboundId, receivedAt);
}
export async function remind(store: TripStore, travelerId: string) {
  const person = store.state.travelers.find((t) => t.traveler_id === travelerId);
  const option = store.state.options.find((o) => o.selected);
  const outreach = store.state.outreach.find((o) => o.traveler_id === travelerId && o.purpose === "trip_confirmation" && o.metadata.option_id === option?.id && o.status === "sent");
  if (!person || !outreach || person.confirmation_status !== "pending" || store.state.trip.status !== "awaiting_travelers") throw new HttpError(409, "This traveler has no pending confirmation.");
  if (!canRemind(outreach.last_reminder_at ?? outreach.sent_at, new Date())) throw new HttpError(429, "Wait two hours between confirmation emails and reminders.");
  const original = await getMessage(store.owner, outreach.gmail_message_id!, store.audit);
  const messageId = mailHeader(original, "message-id");
  const subject = mailHeader(original, "subject");
  const root = { ...outreach, metadata: { ...outreach.metadata, message_id: messageId, subject } };
  await notify(store, { email: person.traveler.email, name: person.traveler.full_name }, {
    key: store.id + ":reminder:" + outreach.id + ":" + outreach.reminder_count, purpose: "Trip confirmation reminder", kind: "send_reminder",
    facts: { trip: store.state.trip.title, request: "Please review the itinerary and confirm or propose another time." },
    links: [{ label: store.state.trip.extracted?.language === "fr" ? "Répondre" : "Review and reply", url: await outreachLink(outreach) }], reminder: root,
  });
}
export async function postBookingNext(store: TripStore) {
  if (store.state.workflow.coordination.post_booking_done) return;
  for (const booking of store.state.bookings.filter((b) => ["quoted", "booked"].includes(b.status))) {
    const person = store.state.travelers.find((t) => t.traveler_id === booking.traveler_id)!;
    for (const event of itineraryEvents([booking], null)) {
      const key = store.id + ":calendar:" + event.id;
      if (store.state.actions.some((a) => a.idempotency_key === key)) continue;
      const action = proposal(store, { kind: "calendar_invite", summary: "Calendar invitation · " + person.traveler.full_name + " · " + event.title,
        idempotency_key: key, payload: { operation: "calendar_insert", booking_id: booking.id,
          event: { summary: (event.tentative ? "[Tentative] " : "") + event.title, location: event.location,
            description: event.tentative ? "Unpaid travel quote. Confirm payment and provider status with your travel manager before departure." : "Confirmed travel.",
            start: event.allDay ? { date: event.start } : { dateTime: event.start }, end: event.allDay ? { date: event.end } : { dateTime: event.end },
            attendees: [{ email: person.traveler.email }], status: event.tentative ? "tentative" : "confirmed" } } });
      await store.save({ actions: [action], events: [{ title: "Calendar invitation prepared", detail: action.summary }] }); return;
    }
  }
  for (const person of store.state.travelers) {
    const key = store.id + ":recap:" + person.traveler_id + ":" + store.state.bookings.map((b) => b.id).sort().join(",");
    if (store.state.actions.some((a) => a.idempotency_key === key)) continue;
    await notify(store, { email: person.traveler.email, name: person.traveler.full_name }, { key, purpose: "Travel recap", kind: "send_recap",
      facts: { trip: store.state.trip.title, meeting: store.state.trip.meeting, bookings: store.state.bookings.filter((b) => b.traveler_id === person.traveler_id && ["quoted", "booked"].includes(b.status)).map((b) => ({
        kind: b.kind, status: b.status, provider_ref: b.provider_ref, itinerary: JSON.parse(JSON.stringify(b.details, (key, value) => ["token", "payment_link", "checkout_url"].includes(key) ? undefined : value)),
      })), instruction: "Quotes are unpaid; no ticket is issued. Include times, addresses, provider reference and ask them to contact their travel manager. Never include payment links." } }); return;
  }
  const key = store.id + ":manager-recap:" + store.state.bookings.map((b) => b.id).sort().join(",");
  if (!store.state.actions.some((a) => a.idempotency_key === key)) {
    const profile = await store.db.from("profiles").select("email,full_name").eq("id", store.owner).single(); planningDatabase(profile.error);
    await notify(store, { email: profile.data!.email, name: profile.data!.full_name }, { key, purpose: "Manager travel recap", kind: "send_recap",
      facts: { trip: store.state.trip.title, note: "Unpaid quotes; review final prices and cancellation terms. Travelers have tentative calendar invitations." },
      links: store.state.bookings.filter((b) => ["quoted", "booked"].includes(b.status) && !store.state.bookings.some((other) => other.payment_link === b.payment_link && !["quoted", "booked"].includes(other.status))).filter((b, i, all) => b.payment_link && all.findIndex((o) => o.payment_link === b.payment_link) === i)
        .map((b) => ({ label: "Jinko · " + store.state.travelers.find((t) => t.traveler_id === b.traveler_id)!.traveler.full_name, url: b.payment_link! })) }); return;
  }
  await store.save({ trip: { workflow: { ...store.state.workflow, coordination: { ...store.state.workflow.coordination, post_booking_done: true } } },
    events: [{ title: "Travel coordination complete", detail: "Calendar invitations and recap emails are saved. Payment remains external." }] });
}
