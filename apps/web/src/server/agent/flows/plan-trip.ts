import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionSchema, BookingDetailsSchema, BookingSchema, FlightDetailsSchema, HotelDetailsSchema, TravelerRecordSchema, type Action, type TripOption, type SearchResult } from "@repo/types";
import { assertActionExecutable, assertBookingReady, calendarConflicts, buildBundles, classifyAction, effectivePolicy, evaluatePolicy, filterDraftReturnFlights, includeRetainedHotels, resolveRequest, travelerCost } from "@repo/core";
import { extractRequest, explainOptions } from "../../integrations/openai";
import { withJinko } from "../../integrations/jinko";
import { euroAmount } from "../../integrations/jinko-contract";
import { HttpError } from "../../http";
import { planningDatabase, type TripStore } from "../store";

export async function understand(store: TripStore) {
  const { trip, workflow, directory } = store.state;
  if (trip.status !== "understanding") return;
  const extracted = await extractRequest(trip.request_text, directory, workflow.traveler_ids, new Date(), store.audit);
  const resolved = resolveRequest(extracted, directory, workflow.traveler_ids, new Date());
  for (const person of resolved.newTravelers) {
    const created = await store.db.from("travelers").upsert({ ...person, owner_id: store.owner }, { onConflict: "owner_id,email", ignoreDuplicates: true });
    planningDatabase(created.error);
    const found = await store.db.from("travelers").select("*").eq("owner_id", store.owner).eq("email", person.email).single();
    planningDatabase(found.error);
    resolved.travelerIds.push(TravelerRecordSchema.parse(found.data).id);
  }
  const request = resolved.request;
  const missing = request.missingFields.length > 0;
  await store.save({
    trip: {
      title: request.title || request.destination || trip.title, destination: request.destination, extracted: request, meeting: request.meeting,
      budget_per_traveler: request.budget_per_traveler, status: store.next(missing ? "needs_info" : "checking_availability"),
      workflow: { ...workflow, journey: resolved.journey, traveler_ids: workflow.traveler_ids, searches: {}, error: null, coordination: { ...workflow.coordination, meeting_checked: false, traveler_journeys: {}, replan_traveler: null } },
    },
    replace_travelers: true,
    travelers: [...new Set(resolved.travelerIds)].map((traveler_id) => ({ traveler_id, confirmation_status: "not_requested", booking_details: null })),
    events: [{ title: missing ? "More information needed" : "Request understood", detail: missing ? request.missingFields.join(" ") : "The coordinator will check calendar availability and request traveler consent when needed." }],
  });
}

export async function searchNext(store: TripStore) {
  const { trip, workflow, travelers } = store.state;
  if (trip.status !== "searching") return;
  let journey = workflow.journey;
  if (!journey || !trip.meeting || !trip.extracted) throw new HttpError(409, "The travel request is incomplete.");
  const person = travelers.find((t) => !workflow.searches[t.traveler_id]);
  if (person) {
    journey = workflow.coordination.traveler_journeys[person.traveler_id] ?? journey;
    const searchJourney = journey;
    await store.event("Searching for " + person.traveler.full_name, "One adult and one hotel room per traveler; at most two provider searches run concurrently.");
    const result = await withJinko(store.audit, async (jinko): Promise<SearchResult> => {
      // Two independent read operations, bounded to one traveler per persisted step.
      const settled = await Promise.allSettled([
        searchJourney.transport === "flight" ? jinko.searchFlights(person.traveler.home_airport, searchJourney, trip.meeting!, trip.extracted!.language) : Promise.resolve(null),
        searchJourney.hotel_needed ? jinko.searchHotels(searchJourney, trip.meeting!.timezone) : Promise.resolve(null),
      ]);
      for (const item of settled) if (item.status === "rejected") throw item.reason;
      const f = settled[0].status === "fulfilled" ? settled[0].value : null;
      const h = settled[1].status === "fulfilled" ? settled[1].value : null;
      return { flights: f?.flights ?? [], hotels: h?.hotels ?? [], warnings: [...(f?.warnings ?? []), ...(h?.warnings ?? [])],
        raw: { flights: f?.raw ?? null, hotels: h?.raw ?? null }, searched_at: new Date().toISOString() };
    });
    if (trip.card?.validated_at && workflow.attempt === 0 && !workflow.coordination.replan_traveler && !workflow.disruption) {
      result.flights = filterDraftReturnFlights(result.flights, trip.card, trip.meeting.timezone);
    }
    const available = result.flights.filter((flight) => calendarConflicts({ traveler_id: person.traveler_id, flight, hotel: null }, person).length === 0);
    if (available.length !== result.flights.length) result.warnings.push("Flights conflicting with known calendar events were excluded.");
    result.flights = available;
    await store.save({ trip: { workflow: { ...workflow, searches: { ...workflow.searches, [person.traveler_id]: result } } },
      events: [{ title: "Travel search saved", detail: person.traveler.full_name + ": " + result.flights.length + " fares and " + result.hotels.length + " hotel rates.", data: { traveler_id: person.traveler_id, warnings: result.warnings } }] });
    return;
  }
  // Empty inventory is a completed search, never a request for more details.
  // Do not manufacture partial/free bundles when a required travel item is absent.
  const incompleteInventory = travelers.some((person) => {
    const request = workflow.coordination.traveler_journeys[person.traveler_id] ?? workflow.journey!;
    const result = workflow.searches[person.traveler_id];
    return !result || request.transport === "flight" && !result.flights.length || request.hotel_needed && !result.hotels.length;
  });
  if (incompleteInventory) {
    await store.save({ trip: { status: store.next("options_ready"), extracted: { ...trip.extracted, missingFields: [] } }, options: [],
      events: [{ title: "Search complete", detail: "No matching live offers were found for the whole team." }] });
    return;
  }
  const policy = effectivePolicy(await store.policy(), trip.budget_per_traveler);
  const bundles = buildBundles(workflow.searches, trip.meeting.start, policy);
  const options: TripOption[] = bundles.map((b) => ({
    id: randomUUID(), owner_id: store.owner, trip_id: store.id, label: b.label, rank: b.rank, total_eur: b.totalEur,
    per_traveler: b.option.per_traveler, compliant: b.compliant, violations: b.violations,
    explanation: "", selected: false, exception_approved: false, exception_note: null,
  }));
  await store.event("Policy and ranking completed", "Options ranked by compliance, cost, arrival margin and duration.", { count: options.length });
  const explanations = await explainOptions(options.map((o) => ({ ...o, per_traveler: o.per_traveler.map(({ traveler_id, ...item }) => ({ traveler_id, ...item })) })), trip.extracted.language, store.audit);
  options.forEach((option) => { option.explanation = explanations.get(option.id)!; });
  await store.save({ trip: { status: store.next("options_ready") }, options,
    events: [{ title: "Options ready", detail: options.length + " distinct live options, ranked and explained." }] });
}

export async function prepareDecisions(store: TripStore) {
  if (store.state.trip.status !== "awaiting_travelers") return;
  const option = store.state.options.find((o) => o.selected);
  if (!option) throw new HttpError(409, "Select an option first.");
  assertBookingReady(option, store.state.travelers, new Date());
  const actions: Action[] = option.per_traveler.map((item) => {
    const person = store.state.travelers.find((t) => t.traveler_id === item.traveler_id)!;
    const proposal = { kind: "book" as const, cost_eur: travelerCost(item), reversible: false };
    return ActionSchema.parse({
      ...proposal, id: randomUUID(), owner_id: store.owner, trip_id: store.id,
      summary: "Prepare flight / hotel quote for " + person.traveler.full_name,
      gate: classifyAction(proposal), status: "proposed", decided_at: null, result: null,
      rationale: "Create a Jinko cart and payment link. No payment will be made. Optional extras are excluded. Cancellation terms may be incomplete; the checkout page is authoritative.",
      payload: { option_id: option.id, traveler_id: item.traveler_id, item, booking_details: person.booking_details,
        email: person.traveler.email, booking_ids: { flight: randomUUID(), hotel: randomUUID() } },
      idempotency_key: store.id + ":" + option.id + ":" + item.traveler_id,
    });
  });
  await store.save({ trip: { status: store.next("ready_to_book") }, actions,
    events: [{ title: "Manager approval required", detail: "Each traveler’s quote requires a recorded decision.", data: { actions: actions.map((a) => a.id) } }] });
}

const QuoteProgressSchema = z.object({
  stage: z.enum(["add_flight", "add_hotel", "traveler", "checkout", "done"]),
  provider_trip_id: z.string().optional(), inflight: z.boolean().default(false),
  raw: z.record(z.unknown()).default({}), error: z.string().optional(),
  checkout_url: z.string().optional(), expires_at: z.string().nullable().optional(), quote_total_eur: z.number().nullable().optional(),
});
const PayloadSchema = z.object({
  option_id: z.string().uuid(), traveler_id: z.string().uuid(), booking_details: BookingDetailsSchema,
  email: z.string().email(), booking_ids: z.object({ flight: z.string().uuid(), hotel: z.string().uuid() }),
});
export async function quoteNext(store: TripStore) {
  const { options, trip } = store.state;
  if (trip.status !== "booking") return;
  const selectedId = options.find((o) => o.selected)?.id;
  const actions = store.state.actions.filter((a) => a.payload.option_id === selectedId);
  const action = actions.find((a) => a.status === "executing") ?? actions.find((a) => a.status === "approved");
  if (!action) {
    if (actions.length && actions.every((a) => a.status === "executed")) {
      await store.save({ trip: { status: store.next("booked") }, events: [{ title: "Payment links ready", detail: "Quotes only. No payment has been made and no ticket or room is confirmed." }] });
    }
    return;
  }
  const payload = PayloadSchema.parse(action.payload);
  const option = options.find((o) => o.id === payload.option_id && o.selected);
  if (!option) throw new HttpError(409, "The approved option is no longer selected.");
  const item = option.per_traveler.find((i) => i.traveler_id === payload.traveler_id)!;
  let progress = QuoteProgressSchema.parse(action.result ?? { stage: item.flight ? "add_flight" : "add_hotel" });
  if (progress.inflight) {
    const error = "The previous Jinko call may have succeeded but its result was not saved. Do not retry it. Reconcile the provider cart" + (progress.provider_trip_id ? " " + progress.provider_trip_id : " with Jinko support") + " before continuing.";
    await store.save({ actions: [{ ...action, status: "failed", result: { ...progress, error } }],
      trip: { workflow: { ...store.state.workflow, error } }, events: [{ title: "Quote needs manual reconciliation", detail: error }] });
    return;
  }
  if (action.status === "approved") {
    assertActionExecutable(action);
    assertBookingReady(option, store.state.travelers, new Date());
    const policy = effectivePolicy(await store.policy(), trip.budget_per_traveler);
    const current = evaluatePolicy({ id: option.id, per_traveler: includeRetainedHotels(option.per_traveler, store.state.bookings), meeting_start: trip.meeting?.start ?? null }, policy);
    if (JSON.stringify(current.violations) !== JSON.stringify(option.violations)) throw new HttpError(409, "Travel policy changed. Search again and approve a fresh option.");
    await store.save({ actions: [{ ...action, status: "executing", result: progress }],
      events: [{ title: "Approved quote started", detail: action.summary, data: { action_id: action.id } }] });
  } else if (!action.decided_at || action.gate !== "needs_manager") throw new HttpError(409, "A recorded manager decision is required.");
  const active = store.state.actions.find((a) => a.id === action.id)!;
  // Persist intent before every non-idempotent provider mutation. A lost response
  // causes manual reconciliation, never an automatic repeat or a second cart.
  const next = await withJinko(store.audit, async (jinko) => {
    await store.save({ actions: [{ ...active, result: { ...progress, inflight: true } }] });
    if (progress.stage === "add_flight" || progress.stage === "add_hotel") {
      const offer = progress.stage === "add_flight" ? FlightDetailsSchema.parse(item.flight!.details) : HotelDetailsSchema.parse(item.hotel!.details);
      const result = await jinko.addItem(offer.token, progress.provider_trip_id);
      return { ...progress, provider_trip_id: result.trip_id,
        stage: progress.stage === "add_flight" && item.hotel ? "add_hotel" as const : "traveler" as const,
        inflight: false, raw: { ...progress.raw, [progress.stage]: result.raw } };
    }
    if (!progress.provider_trip_id) throw new Error("Provider cart reference missing.");
    if (progress.stage === "traveler") {
      const result = await jinko.setTraveler(progress.provider_trip_id, payload.booking_details, payload.email, !!item.flight);
      return { ...progress, stage: "checkout" as const, inflight: false, raw: { ...progress.raw, traveler: result.raw } };
    }
    const result = await jinko.quote(progress.provider_trip_id);
    let total: number | null = null;
    if (result.data.total_amount !== undefined) total = euroAmount(result.data.total_amount);
    return { ...progress, stage: "done" as const, inflight: false,
      raw: { ...progress.raw, checkout: result.raw }, checkout_url: result.data.checkout_url,
      expires_at: result.data.expires_at ?? null, quote_total_eur: total };
  });
  progress = QuoteProgressSchema.parse(next);
  if (progress.stage !== "done") {
    await store.save({ actions: [{ ...active, result: progress }], events: [{ title: "Quote checkpoint saved", detail: "Next step: " + progress.stage, data: { action_id: action.id, provider_trip_id: progress.provider_trip_id } }] });
    return;
  }
  const bookings = (["flight", "hotel"] as const).flatMap((kind) => {
    const value = item[kind];
    if (!value) return [];
    const details = kind === "flight" ? FlightDetailsSchema.parse(value.details) : HotelDetailsSchema.parse(value.details);
    return [BookingSchema.parse({
      id: payload.booking_ids[kind], owner_id: store.owner, trip_id: store.id, traveler_id: payload.traveler_id,
      kind, status: "quoted", provider_ref: progress.provider_trip_id, payment_link: progress.checkout_url,
      price_eur: kind === "flight" ? item.flight!.price_eur : item.hotel!.total_eur ?? item.hotel!.nightly_eur * item.hotel!.nights,
      cancellation_terms: details.cancellation_terms,
      details: { ...details, search_price_eur: kind === "flight" ? item.flight!.price_eur : item.hotel!.total_eur,
        quote_total_eur: progress.quote_total_eur, quote_expires_at: progress.expires_at, action_id: action.id },
      raw: { search: store.state.workflow.searches[payload.traveler_id]?.raw ?? {}, quote: progress.raw },
    })];
  });
  await store.save({ actions: [{ ...active, status: "executed", result: progress }], bookings,
    events: [{ title: "Payment link saved", detail: "Unpaid quote. Review the final provider price and terms before paying externally.", data: { action_id: action.id, quote_total_eur: progress.quote_total_eur ?? null } }] });
}
