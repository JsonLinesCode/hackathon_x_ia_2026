import "server-only";
import { randomUUID } from "node:crypto";
import { DisruptionStateSchema, CancellationPreviewSchema, FlightDetailsSchema, TripOptionSchema, type DisruptionEvent, type DisruptionState, type Action, type TripOption } from "@repo/types";
import { assertActionExecutable, cancellationEstimate, cancellationTotal, effectivePolicy, evaluatePolicy, isLate, includeRetainedHotels, rankOptions } from "@repo/core";
import { HttpError } from "../../http";
import { withJinko } from "../../integrations/jinko";
import { listEvents, calendarEventId } from "../../integrations/calendar";
import { explainOptions } from "../../integrations/openai";
import { notify, proposal } from "../notify";
import { planningDatabase, type TripStore } from "../store";

async function saveDisruption(store: TripStore, value: DisruptionState) {
  await store.save({ trip: { workflow: { ...store.state.workflow, disruption: value } } });
}
export async function receiveDisruption(store: TripStore, event: DisruptionEvent, inboundId: string) {
  const old = store.state.workflow.disruption;
  if (old?.id === inboundId) { await store.save({ inbound_ids: [inboundId] }); return; }
  if ((old && old.stage !== "resolved") || store.state.actions.some((a) => a.kind === "book" && a.status === "executing")) throw new HttpError(409, "Finish the current recovery or quote before processing another disruption.");
  if (["cancelled", "completed", "reported"].includes(store.state.trip.status)) { await store.save({ inbound_ids: [inboundId] }); return; }
  if (event.kind.startsWith("flight_") && !store.state.bookings.some((b) => b.id === event.booking_id && b.kind === "flight")) throw new HttpError(400, "Select the affected flight booking.");
  if (event.kind === "meeting_moved" && (!event.new_start || !event.new_end || Date.parse(event.new_end) <= Date.parse(event.new_start))) throw new HttpError(400, "A moved meeting requires valid new start/end instants.");
  const disruption = DisruptionStateSchema.parse({ id: inboundId, event, previous_status: store.state.trip.status, stage: "alerting", calendar_unknown: store.state.travelers.filter((t) => !["direct", "consented"].includes(t.traveler.calendar_access)).map((t) => t.traveler_id) });
  const affected = store.state.bookings.find((b) => b.id === event.booking_id);
  let changed = affected;
  if (affected && event.kind === "flight_cancelled") changed = { ...affected, status: "cancel_requested" };
  if (affected && event.kind === "flight_delayed" && event.new_arrival) {
    const flight = FlightDetailsSchema.parse(affected.details);
    if (Date.parse(event.new_arrival) <= Date.parse(flight.outbound.departure)) throw new HttpError(400, "The new arrival must follow departure.");
    changed = { ...affected, details: { ...affected.details, delay_original_arrival: flight.outbound.arrival,
      outbound: { ...flight.outbound, arrival: event.new_arrival,
        duration_minutes: Math.ceil((Date.parse(event.new_arrival) - Date.parse(flight.outbound.departure)) / 60000),
        segments: flight.outbound.segments.map((segment, i, all) => i === all.length - 1 ? { ...segment, arrival: event.new_arrival! } : segment) } } };
  }
  await store.save({ bookings: changed ? [changed] : [], trip: { status: store.next("disrupted"), workflow: { ...store.state.workflow, error: null, disruption } },
    inbound_ids: [inboundId], events: [{ source: "disruption", title: event.kind.replaceAll("_", " "), detail: event.detail, data: { inbound_id: inboundId, booking_id: event.booking_id } }] });
}
async function notifyDisruption(store: TripStore, d: DisruptionState, suffix: string, detail: string) {
  const recipients = store.state.travelers.map((t) => ({ email: t.traveler.email, name: t.traveler.full_name }));
  const profile = await store.db.from("profiles").select("email,full_name").eq("id", store.owner).single(); planningDatabase(profile.error);
  recipients.push({ email: profile.data!.email, name: profile.data!.full_name });
  if (isLate(d.event.new_arrival, store.state.trip.meeting?.start ?? null) && store.state.workflow.coordination.organizer_email) {
    recipients.push({ email: store.state.workflow.coordination.organizer_email, name: "Meeting organizer" });
  }
  for (const recipient of recipients.filter((r, i, all) => all.findIndex((o) => o.email === r.email) === i)) {
    const key = store.id + ":disruption:" + d.id + ":" + suffix + ":" + recipient.email;
    if (store.state.actions.some((a) => a.idempotency_key === key)) continue;
    await notify(store, recipient, { key, purpose: suffix === "alert" ? "Travel disruption alert" : "Travel recovery update",
      facts: { trip: store.state.trip.title, meeting: store.state.trip.meeting, detail, new_arrival: d.event.new_arrival,
        instruction: "State only confirmed facts. Cancellation and refund outcomes remain pending unless explicitly completed." } });
    return true;
  }
  return false;
}
async function checkOtherEvents(store: TripStore, d: DisruptionState) {
  const journey = store.state.workflow.journey, meeting = store.state.trip.meeting;
  if (!journey || !meeting) { await saveDisruption(store, { ...d, stage: "previewing" }); return; }
  const calendars = ["manager", ...store.state.travelers.filter((t) => ["direct", "consented"].includes(t.traveler.calendar_access)).map((t) => t.traveler_id)];
  const key = calendars.find((id) => !d.calendars_checked.includes(id));
  if (!key) { await saveDisruption(store, { ...d, stage: "previewing" }); return; }
  const start = (journey.departure_date ?? journey.hotel_checkin ?? meeting.start.slice(0, 10)) + "T00:00:00Z";
  const end = new Date(Date.parse((journey.return_date ?? journey.hotel_checkout ?? meeting.end.slice(0, 10)) + "T00:00:00Z") + 86400000).toISOString();
  let found: DisruptionState["other_events"] = [], unknown = d.calendar_unknown;
  try {
    const person = store.state.travelers.find((t) => t.traveler_id === key);
    const events = await listEvents(store.owner, start, end, store.audit, person?.traveler.calendar_access === "consented" ? key : undefined, person?.traveler.calendar_access === "direct" ? person.traveler.email : "primary");
    found = events.filter((e) => e.id !== meeting.google_event_id && e.status !== "cancelled" && !e.extendedProperties?.private?.trip_id &&
      !!store.state.trip.destination && e.location?.toLowerCase().includes(store.state.trip.destination.toLowerCase()))
      .map((e) => ({ title: e.summary ?? "Calendar event", at: e.start?.dateTime ?? e.start?.date ?? "", calendar: key }));
  } catch { unknown = [...unknown, key]; }
  await saveDisruption(store, { ...d, calendars_checked: [...d.calendars_checked, key], calendar_unknown: unknown, other_events: [...d.other_events, ...found] });
}
async function replacementOptions(store: TripStore, d: DisruptionState) {
  const affected = store.state.bookings.find((b) => b.id === d.event.booking_id);
  const person = store.state.travelers.find((t) => t.traveler_id === affected?.traveler_id);
  const meeting = store.state.trip.meeting;
  const journey = person ? store.state.workflow.coordination.traveler_journeys[person.traveler_id] ?? store.state.workflow.journey : null;
  if (!affected || !person || !journey || !meeting) return [];
  const old = FlightDetailsSchema.parse(affected.details);
  const offers = await withJinko(store.audit, (jinko) => jinko.searchFlights(old.outbound.origin, { ...journey, arrival_window: null }, meeting, store.state.trip.extracted?.language ?? "en", true));
  const flights = offers.flights.filter((f) => Date.parse(f.departure) > Date.now() && !FlightDetailsSchema.parse(f.details).outbound.segments.some((s) => old.outbound.segments.some((previous) => previous.flight_number === s.flight_number && previous.carrier === s.carrier && previous.departure === s.departure)));
  if (!flights.length) { await store.event("No replacement flights", "Supply different travel dates or contact the provider; no replacement has been invented."); return []; }
  const policy = effectivePolicy(await store.policy(), store.state.trip.budget_per_traveler);
  const ranked = rankOptions(flights.map((flight) => ({ id: randomUUID(), meeting_start: meeting.start, per_traveler: includeRetainedHotels([{ traveler_id: person.traveler_id, flight, hotel: null }], store.state.bookings) })), policy);
  const options: TripOption[] = ranked.slice(0, 3).map((entry, index) => TripOptionSchema.parse({
    ...entry.option, per_traveler: entry.option.per_traveler.map((p) => ({ ...p, hotel: null })), owner_id: store.owner, trip_id: store.id, rank: index + 1, label: "Replacement " + (index + 1),
    total_eur: entry.option.per_traveler.reduce((sum, p) => sum + (p.flight?.price_eur ?? 0), 0), ...evaluatePolicy(entry.option, policy),
    explanation: "", selected: false, exception_approved: false, exception_note: null,
  }));
  const explanations = await explainOptions(options, store.state.trip.extracted?.language ?? "en", store.audit);
  return options.map((o) => ({ ...o, explanation: explanations.get(o.id)! }));
}
export async function disruptionNext(store: TripStore) {
  let d = store.state.workflow.disruption;
  if (!d || d.stage === "resolved") return;
  if (d.stage === "alerting") {
    if (d.event.kind === "flight_cancelled" && d.event.booking_id && await removeTravelInvitations(store, d.id, [d.event.booking_id])) return;
    if (d.event.kind === "flight_delayed" && d.event.new_arrival && await updateDelayedInvitation(store, d)) return;
    if (await notifyDisruption(store, d, "alert", d.event.detail || d.event.kind.replaceAll("_", " "))) return;
    await saveDisruption(store, { ...d, stage: "checking" }); return;
  }
  if (d.stage === "checking") { await checkOtherEvents(store, d); return; }
  if (d.stage === "previewing") {
    const booking = store.state.bookings.find((b) => ["quoted", "booked", "cancel_requested"].includes(b.status) && !d!.previews[b.id]);
    if (booking) {
      const result = await withJinko(store.audit, (jinko) => jinko.previewCancellation(booking));
      await store.save({ bookings: [{ ...booking, raw: { ...booking.raw, cancellation_preview: result.raw } }],
        trip: { workflow: { ...store.state.workflow, disruption: { ...d, previews: { ...d.previews, [booking.id]: result.preview } } } },
        events: [{ title: "Cancellation reviewed", detail: result.preview.instruction, data: { booking_id: booking.id, provider_fee_eur: result.preview.fee_eur, stored_estimate: cancellationEstimate(booking, new Date()) } }] });
      return;
    }
    await saveDisruption(store, { ...d, stage: "proposing" }); return;
  }
  if (d.stage === "proposing") {
    const options = d.event.kind.startsWith("flight_") ? await replacementOptions(store, d) : [];
    const previews = Object.values(d.previews);
    const actions = [
      proposal(store, { kind: "cancel_booking", summary: "Cancel all travel", cost_eur: cancellationTotal(previews), reversible: false,
        rationale: "Unknown fees require manual reconciliation. Only verified provider cancellation previews can execute.",
        payload: { operation: "cancel_all", disruption_id: d.id, previews }, idempotency_key: d.id + ":cancel" }),
      proposal(store, { kind: "modify_booking", summary: "Move travel dates", cost_eur: 0, reversible: true,
        rationale: "Enter dates before approving. New quotes need separate approval; existing bookings require reconciliation.",
        payload: { operation: "move_dates", disruption_id: d.id }, idempotency_key: d.id + ":move" }),
      proposal(store, { kind: "modify_booking", summary: "Keep the trip", cost_eur: 0, reversible: true,
        rationale: "Keep existing travel. Other events found: " + d.other_events.length + ". Unknown calendars: " + d.calendar_unknown.length + ".",
        payload: { operation: "keep_trip", disruption_id: d.id }, idempotency_key: d.id + ":keep" }),
    ];
    await store.save({ actions, trip: { workflow: { ...store.state.workflow, disruption: { ...d, stage: "waiting", action_ids: actions.map((a) => a.id), replacement_options: options } } },
      events: [{ title: "Recovery decisions ready", detail: "Compare cancellation, new dates or keeping travel. Replacement flights need a separate quote approval." }] }); return;
  }
  if (d.stage === "waiting") {
    const action = store.state.actions.find((a) => d!.action_ids.includes(a.id) && ["approved", "executing"].includes(a.status));
    if (!action) return;
    if (action.status === "approved") assertActionExecutable(action);
    await saveDisruption(store, { ...d, stage: "resolving", chosen_action: action.id }); d = store.state.workflow.disruption!;
  }
  const action = store.state.actions.find((a) => a.id === d.chosen_action);
  if (!action) return;
  if (action.status === "executing" && !action.decided_at) throw new HttpError(409, "A recorded approval is required.");
  if (action.status === "approved") {
    assertActionExecutable(action);
    await store.save({ actions: [{ ...action, status: "executing", result: { completed: [], manual: {} } }] }); return;
  }
  if (action.status === "executing" && action.payload.operation === "cancel_all") { await cancelNext(store, action); return; }
  if (action.status === "executing" && action.payload.operation === "move_dates") { await launchMovedSearch(store, action, d); return; }
  if (action.status === "executing") {
    const meeting = store.state.trip.meeting;
    const changed = meeting && d.event.kind === "meeting_moved" ? { ...meeting, start: d.event.new_start!, end: d.event.new_end! }
      : meeting && d.event.kind === "meeting_cancelled" ? { ...meeting, cancelled: true } : meeting;
    await store.save({ actions: [{ ...action, status: "executed", result: { kept: true } }], trip: { meeting: changed } }); return;
  }
  if (action.status === "executed") {
    const cancelling = action.payload.operation === "cancel_all";
    if (cancelling && store.state.bookings.some((b) => ["quoted", "booked", "cancel_requested"].includes(b.status))) return;
    if (cancelling && await removeTravelInvitations(store, d.id)) return;
    if (await notifyDisruption(store, d, "resolved", cancelling ? "All travel cancellations have been confirmed." : "The manager decided to keep the trip.")) return;
    await store.save({ trip: { status: store.next(cancelling ? "cancelled" : d.previous_status),
      workflow: { ...store.state.workflow, error: null, disruption: { ...d, stage: "resolved", resolution: cancelling ? "cancelled" : "kept" } } },
      events: [{ title: cancelling ? "Trip cancelled" : "Trip retained", actor: "manager" }] });
  }
}
async function cancelNext(store: TripStore, action: Action) {
  const result = { completed: [] as string[], manual: {} as Record<string, string>, operations: {} as Record<string, string>, inflight: null as string | null, next_poll_at: null as string | null, ...action.result };
  const completed = result.completed as string[], manual = result.manual as Record<string, string>, operations = result.operations as Record<string, string>;
  const preview = CancellationPreviewSchema.array().parse(action.payload.previews).find((p) => !completed.includes(p.booking_id));
  if (!preview) { await store.save({ actions: [{ ...action, status: "executed", result }], events: [{ title: Object.keys(manual).length ? "Manual cancellation required" : "Provider cancellations complete", detail: Object.values(manual).join("\n") }] }); return; }
  const booking = store.state.bookings.find((b) => b.id === preview.booking_id)!;
  if (preview.mode === "manual" || result.inflight === booking.id || (preview.expires_at && Date.parse(preview.expires_at) <= Date.now() && !operations[booking.id])) {
    const instruction = result.inflight === booking.id ? "The provider call may have succeeded. Reconcile with Jinko before retrying. Reference: " + preview.booking_ref
      : preview.mode === "manual" ? preview.instruction : "Preview expired. Obtain a new fee quote from Jinko. Reference: " + preview.booking_ref;
    await store.save({ bookings: [{ ...booking, status: "cancel_requested" }],
      actions: [{ ...action, result: { ...result, completed: [...completed, booking.id], manual: { ...manual, [booking.id]: instruction }, inflight: null } }],
      events: [{ title: "Cancellation requires manual follow-up", detail: instruction, data: { booking_id: booking.id } }] }); return;
  }
  if (operations[booking.id] && result.next_poll_at && Date.parse(String(result.next_poll_at)) > Date.now()) return;
  if (!operations[booking.id]) await store.save({ actions: [{ ...action, result: { ...result, inflight: booking.id } }] });
  const response = await withJinko(store.audit, (jinko) => jinko.cancel(preview, operations[booking.id]));
  const status = response.data.status.toLowerCase();
  const done = ["completed", "confirmed", "cancelled", "refunded", "voided"].includes(status), refused = ["failed", "rejected", "manual_required"].includes(status);
  await store.save({ bookings: [{ ...booking, status: done ? "cancelled" : "cancel_requested", raw: { ...booking.raw, cancellation: response.raw } }],
    actions: [{ ...action, result: { ...result, inflight: null,
      operations: { ...operations, [booking.id]: response.data.operation }, completed: done || refused ? [...completed, booking.id] : completed,
      manual: refused ? { ...manual, [booking.id]: "Provider cancellation " + status + ". Contact Jinko with " + preview.booking_ref + " and " + response.data.operation } : manual,
      next_poll_at: new Date(Date.now() + 30000).toISOString() } }],
    events: [{ title: "Cancellation status: " + status, data: { booking_id: booking.id, operation: response.data.operation } }] });
}
export async function removeTravelInvitations(store: TripStore, reason: string, bookingIds?: string[]) {
  for (const invitation of store.state.actions.filter((a) => a.payload.operation === "calendar_insert" && a.status === "executed" && (!bookingIds || bookingIds.includes(String(a.payload.booking_id))))) {
    const key = reason + ":calendar-delete:" + invitation.id;
    if (store.state.actions.some((a) => a.idempotency_key === key)) continue;
    await store.save({ actions: [proposal(store, { kind: "calendar_update", summary: "Remove superseded travel invitation", idempotency_key: key,
      payload: { operation: "calendar_delete", event_id: invitation.result?.google_event_id ?? calendarEventId(invitation.id) } })] }); return true;
  }
  return false;
}
async function launchMovedSearch(store: TripStore, action: Action, d: DisruptionState) {
  const payload = action.payload as { journey?: unknown; meeting?: unknown };
  if (!payload.journey || !payload.meeting) throw new HttpError(409, "Save new dates before approving a move.");
  if (await removeTravelInvitations(store, d.id)) return;
  await store.save({ clear_options: true, actions: [{ ...action, status: "executed", result: { search_started: true } }],
    bookings: store.state.bookings.filter((b) => ["quoted", "booked"].includes(b.status)).map((b) => ({ ...b, status: "cancel_requested" })),
    travelers: store.state.travelers.map((t) => ({ traveler_id: t.traveler_id, confirmation_status: "not_requested", availability: null })),
    trip: { status: store.next("checking_availability"), meeting: payload.meeting as typeof store.state.trip.meeting,
      workflow: { ...store.state.workflow, journey: payload.journey as typeof store.state.workflow.journey, searches: {}, error: null,
        coordination: { ...store.state.workflow.coordination, post_booking_done: false, meeting_checked: false, traveler_journeys: {} },
        disruption: { ...d, stage: "resolved", resolution: "New dates requested; reconcile previous provider bookings separately." } } },
    events: [{ title: "New dates approved", actor: "manager", detail: "Previous bookings require reconciliation. New quotes need separate approval." }] });
}
export async function chooseReplacement(store: TripStore, optionId: string) {
  const d = store.state.workflow.disruption;
  if (!d || d.stage !== "waiting" || d.chosen_action) throw new HttpError(409, "This recovery no longer accepts a replacement.");
  const option = d.replacement_options.find((o) => o.id === optionId);
  if (!option) throw new HttpError(404, "Replacement option not found.");
  const affected = store.state.bookings.find((b) => b.id === d.event.booking_id)!;
  const evaluated = evaluatePolicy({ id: option.id, per_traveler: includeRetainedHotels(option.per_traveler, store.state.bookings), meeting_start: store.state.trip.meeting?.start ?? null }, effectivePolicy(await store.policy(), store.state.trip.budget_per_traveler));
  const rejected = store.state.actions.filter((a) => d.action_ids.includes(a.id) && a.status === "proposed").map((a) => ({ ...a, status: "rejected" as const, decided_at: new Date().toISOString() }));
  await store.save({ clear_options: true, options: [{ ...option, ...evaluated, selected: true }], actions: rejected,
    bookings: [{ ...affected, status: "cancel_requested" }], travelers: [{ traveler_id: affected.traveler_id, confirmation_status: "not_requested" }],
    trip: { status: evaluated.compliant ? "awaiting_travelers" : "awaiting_exception",
      workflow: { ...store.state.workflow, error: null, coordination: { ...store.state.workflow.coordination, post_booking_done: false },
        disruption: { ...d, stage: "resolved", resolution: "Replacement selected; original flight refund requires provider follow-up." } } },
    events: [{ actor: "manager", title: "Replacement selected", detail: "Traveler confirmation, policy checks and separate quote approval remain required." }] });
  while (await removeTravelInvitations(store, d.id, [affected.id])) { /* prepares bounded local action records */ }
  const arrival = option.per_traveler[0].flight?.arrival ?? null, organizer = store.state.workflow.coordination.organizer_email;
  if (organizer && isLate(arrival, store.state.trip.meeting?.start ?? null)) {
    await notify(store, { email: organizer, name: "Meeting organizer" }, { key: d.id + ":replacement-late:" + option.id,
      purpose: "Late arrival update", facts: { trip: store.state.trip.title, meeting: store.state.trip.meeting, arrival, status: "Proposed replacement, awaiting confirmation and quote approval." } });
  }
}

async function updateDelayedInvitation(store: TripStore, d: DisruptionState) {
  const booking = store.state.bookings.find((b) => b.id === d.event.booking_id);
  for (const invitation of store.state.actions.filter((a) => a.payload.operation === "calendar_insert" && a.payload.booking_id === booking?.id && a.status === "executed")) {
    const event = invitation.payload.event as { end?: { dateTime?: string } };
    if (event.end?.dateTime !== booking?.details.delay_original_arrival) continue;
    const key = d.id + ":calendar-delay:" + invitation.id;
    if (store.state.actions.some((a) => a.idempotency_key === key)) continue;
    await store.save({ actions: [proposal(store, { kind: "calendar_update", summary: "Update delayed flight invitation",
      idempotency_key: key, payload: { operation: "calendar_patch", event_id: invitation.result?.google_event_id ?? calendarEventId(invitation.id),
        patch: { end: { dateTime: d.event.new_arrival } } } })] }); return true;
  }
  return false;
}
