import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ addItem: vi.fn(), setTraveler: vi.fn(), quote: vi.fn() }));
vi.mock("../integrations/jinko", () => ({ withJinko: async (_audit: unknown, work: (client: typeof provider) => Promise<unknown>) => work(provider) }));
import { DEFAULT_POLICY, PlanningStateSchema, type Action, type TripOption, type PlanTraveler, type Trip } from "@repo/types";
import { quoteNext, prepareDecisions } from "./flows/plan-trip";
import { runStep } from "./orchestrator";
import { TripStore, type Changes, type TripState } from "./store";
import { transitionTrip } from "@repo/core";
const owner = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const travelerId = "33333333-3333-4333-8333-333333333333";
const optionId = "44444444-4444-4444-8444-444444444444";
const decisionAt = "2026-09-27T10:00:00Z";
function storeFixture() {
  const traveler: PlanTraveler = {
    trip_id: tripId, owner_id: owner, traveler_id: travelerId, availability: null, confirmation_status: "confirmed", response_text: null,
    booking_details: { first_name: "Alice", last_name: "Martin", passenger_type: "ADULT", date_of_birth: null, gender: null, phone: "+33612345678", no_extras: true },
    traveler: { id: travelerId, owner_id: owner, full_name: "Alice Martin", email: "alice@example.com", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: decisionAt },
  };
  const option: TripOption = { id: optionId, owner_id: owner, trip_id: tripId, label: "Hotel", rank: 1, total_eur: 100, compliant: true, violations: [], explanation: "", selected: true, exception_approved: false, exception_note: null,
    per_traveler: [{ traveler_id: travelerId, flight: null, hotel: { nights: 1, nightly_eur: 100, total_eur: 100,
      details: { token: "htl_test", name: "Hotel", hotel_id: "h1", expires_at: null, refundable: true, cancellation_terms: { price_eur: 100, refundable: true, free_until: null, fee_eur: null },
        address: "Paris", checkin: "2026-11-11", checkout: "2026-11-12", timezone: "Europe/Paris", room: "Room", board: "", total_eur: 100, extra_taxes: [] } } }] };
  const trip: Trip = { id: tripId, owner_id: owner, title: "Meeting", request_text: "Hotel for the meeting", extracted: null, destination: "Paris", meeting: null, status: "awaiting_travelers", budget_per_traveler: null, created_at: decisionAt, updated_at: decisionAt };
  const state: TripState = { trip, travelers: [traveler], directory: [traveler.traveler], options: [option], actions: [], bookings: [], timeline: [], outreach: [], running: true, workflow: PlanningStateSchema.parse({}) };
  const saves: Changes[] = [];
  const store = {
    owner, id: tripId, state, audit: vi.fn(), event: vi.fn(), policy: async () => DEFAULT_POLICY,
    next(status: Trip["status"]) { return transitionTrip(state.trip.status, status); },
    async save(changes: Changes) {
      saves.push(structuredClone(changes));
      if (changes.trip) { state.trip = { ...state.trip, ...changes.trip }; if (changes.trip.workflow) state.workflow = changes.trip.workflow; }
      if (changes.actions) for (const action of changes.actions) { const index = state.actions.findIndex((a) => a.id === action.id); if (index < 0) state.actions.push(action); else state.actions[index] = action; }
      if (changes.bookings) for (const booking of changes.bookings) { const index = state.bookings.findIndex((b) => b.id === booking.id); if (index < 0) state.bookings.push(booking); else state.bookings[index] = booking; }
    },
  } as unknown as TripStore;
  return { store, saves };
}
beforeEach(() => {
  vi.clearAllMocks();
  provider.addItem.mockResolvedValue({ trip_id: "trip_provider", raw: { added: true } });
  provider.setTraveler.mockResolvedValue({ trip_id: "trip_provider", raw: { travelers_saved: true } });
  provider.quote.mockResolvedValue({ data: { checkout_url: "https://pay.example.test/quote", total_amount: "EUR 100.00", expires_at: "2026-11-01T12:00:00Z" }, raw: { quote: true } });
});
describe("persisted approval and quote checkpoints", () => {
  it("creates manager proposals, and makes zero Jinko mutations before a decision", async () => {
    const { store } = storeFixture();
    await prepareDecisions(store);
    expect(store.state.actions[0]).toMatchObject({ status: "proposed", gate: "needs_manager", decided_at: null });
    await runStep(store);
    expect(provider.addItem).not.toHaveBeenCalled();
    store.state.trip.status = "booking";
    await quoteNext(store);
    expect(provider.quote).not.toHaveBeenCalled();
  });
  it("executes only the approved action, persists intent first, saves unpaid payment links and never repeats checkout", async () => {
    const { store } = storeFixture();
    await prepareDecisions(store);
    store.state.actions[0] = { ...store.state.actions[0], status: "approved", decided_at: decisionAt };
    store.state.trip.status = "booking";
    store.state.actions.push({ ...store.state.actions[0], id: "55555555-5555-4555-8555-555555555555", status: "rejected", payload: { option_id: "old-option" } });
    provider.addItem.mockImplementation(async () => {
      expect(store.state.actions[0]).toMatchObject({ status: "executing", decided_at: decisionAt, result: { inflight: true } });
      return { trip_id: "trip_provider", raw: { added: true } };
    });
    await quoteNext(store); await quoteNext(store); await quoteNext(store); await quoteNext(store); await quoteNext(store);
    expect(provider.addItem).toHaveBeenCalledTimes(1); expect(provider.setTraveler).toHaveBeenCalledTimes(1); expect(provider.quote).toHaveBeenCalledTimes(1);
    expect(store.state.bookings).toHaveLength(1);
    expect(store.state.bookings[0]).toMatchObject({ status: "quoted", payment_link: "https://pay.example.test/quote", raw: { quote: expect.any(Object) } });
    expect(store.state.actions[0].status).toBe("executed");
    expect(store.state.trip.status).toBe("booked");
  });
  it("fails closed if approval has no recorded date or exception is unapproved", async () => {
    const { store } = storeFixture();
    await prepareDecisions(store); store.state.trip.status = "booking";
    store.state.actions[0].status = "approved";
    await expect(quoteNext(store)).rejects.toThrow(/approval/);
    store.state.actions[0].decided_at = decisionAt; store.state.options[0].compliant = false;
    await expect(quoteNext(store)).rejects.toThrow(/exception/);
    expect(provider.addItem).not.toHaveBeenCalled();
  });
  it("does not repeat an uncertain mutation when the provider response is lost", async () => {
    const { store } = storeFixture();
    await prepareDecisions(store); store.state.trip.status = "booking";
    store.state.actions[0] = { ...store.state.actions[0], status: "approved", decided_at: decisionAt };
    provider.addItem.mockRejectedValue(new Error("Response lost"));
    await runStep(store);
    expect(store.state.actions[0].result).toMatchObject({ inflight: true });
    await runStep(store, true);
    expect(provider.addItem).toHaveBeenCalledTimes(1);
    expect(store.state.actions[0].status).toBe("failed");
    expect(store.state.workflow.error).toContain("Reconcile");
  });
  it("does not invoke Jinko for rejected actions", async () => {
    const { store } = storeFixture();
    await prepareDecisions(store); store.state.trip.status = "booking";
    store.state.actions[0] = { ...store.state.actions[0], status: "rejected", decided_at: decisionAt } as Action;
    await quoteNext(store);
    expect(provider.addItem).not.toHaveBeenCalled();
  });
});
