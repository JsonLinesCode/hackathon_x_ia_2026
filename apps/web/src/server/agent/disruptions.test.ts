import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("../integrations/jinko", () => ({ withJinko: async (_audit: unknown, work: (p: typeof provider) => unknown) => work(provider) }));
import { ActionSchema, PlanningStateSchema, DisruptionStateSchema, type Booking, type Action } from "@repo/types";
import type { TripStore, Changes } from "./store";
import { disruptionNext, receiveDisruption } from "./flows/disruptions";
const id = "11111111-1111-4111-8111-111111111111", bookingId = "22222222-2222-4222-8222-222222222222", actionId = "33333333-3333-4333-8333-333333333333";
function fixture(mode: "manual" | "provider" = "provider") {
  const preview = { booking_id: bookingId, kind: "hotel", mode, booking_ref: "JNK-ABC123", item_id: 1,
    quote: "svq_preview", refund: { value: 8000, currency: "EUR", decimal_places: 2 }, fee_eur: 20, expires_at: null, instruction: "Manual cancellation required" };
  const d = DisruptionStateSchema.parse({ id, event: { kind: "meeting_cancelled", trip_id: id }, previous_status: "booked", stage: "waiting",
    previews: { [bookingId]: preview }, action_ids: [actionId] });
  const action = ActionSchema.parse({ id: actionId, owner_id: id, trip_id: id, kind: "cancel_booking", cost_eur: 20, reversible: false,
    summary: "Cancel all", rationale: "", gate: "needs_manager", status: "proposed", decided_at: null, result: null, idempotency_key: "cancel",
    payload: { operation: "cancel_all", disruption_id: id, previews: [preview] } });
  const state = { trip: { id, status: "disrupted" }, workflow: PlanningStateSchema.parse({ disruption: d }), actions: [action],
    bookings: [{ id: bookingId, kind: "hotel", status: "booked", raw: {} } as Booking], travelers: [], options: [] };
  const store = { owner: id, id, state, audit: vi.fn(), next: (status: string) => status, save: async (change: Changes) => {
    if (change.trip?.workflow) state.workflow = change.trip.workflow;
    if (change.actions) for (const a of change.actions) state.actions[state.actions.findIndex((old) => old.id === a.id)] = a;
    if (change.bookings) state.bookings = change.bookings;
  } } as unknown as TripStore;
  return store;
}
beforeEach(() => vi.clearAllMocks());
describe("recovery execution gate", () => {
  it("does not call a cancellation provider for an unapproved or rejected choice", async () => {
    const store = fixture(); await disruptionNext(store);
    store.state.actions[0].status = "rejected"; await disruptionNext(store);
    expect(provider.cancel).not.toHaveBeenCalled();
  });
  it("persists the approval and inflight marker before cancelling, using the approved refund verbatim", async () => {
    const store = fixture();
    store.state.actions[0] = { ...store.state.actions[0], status: "approved", decided_at: new Date().toISOString() };
    provider.cancel.mockImplementation(async (preview) => {
      expect(store.state.actions[0].result?.inflight).toBe(bookingId);
      expect(preview.refund).toEqual({ value: 8000, currency: "EUR", decimal_places: 2 });
      return { data: { operation: "svc_operation", status: "completed" }, raw: {} };
    });
    await disruptionNext(store); await disruptionNext(store);
    expect(provider.cancel).toHaveBeenCalledTimes(1);
    expect(store.state.bookings[0].status).toBe("cancelled");
  });
  it("turns uncertain mutations into manual reconciliation without another commit", async () => {
    const store = fixture(); store.state.actions[0] = { ...store.state.actions[0], status: "executing", decided_at: new Date().toISOString(), result: { inflight: bookingId } } as Action;
    store.state.workflow.disruption!.stage = "resolving"; store.state.workflow.disruption!.chosen_action = actionId;
    await disruptionNext(store);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(store.state.bookings[0].status).toBe("cancel_requested");
    expect(store.state.actions[0].result?.manual).toHaveProperty(bookingId);
  });
  it("does not claim a manually handled cancellation is complete", async () => {
    const store = fixture("manual"); store.state.actions[0] = { ...store.state.actions[0], status: "approved", decided_at: new Date().toISOString() };
    await disruptionNext(store); await disruptionNext(store); await disruptionNext(store); await disruptionNext(store);
    expect(provider.cancel).not.toHaveBeenCalled(); expect(store.state.bookings[0].status).toBe("cancel_requested");
    expect(store.state.trip.status).toBe("disrupted");
  });
  it("deduplicates an inbound event before creating another recovery", async () => {
    const store = fixture(); const event = store.state.workflow.disruption!.event;
    await receiveDisruption(store, event, id);
    expect(store.state.actions).toHaveLength(1);
  });
});
