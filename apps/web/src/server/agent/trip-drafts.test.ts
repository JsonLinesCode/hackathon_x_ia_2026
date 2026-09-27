import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deps = vi.hoisted(() => ({ interpreter: vi.fn(), from: vi.fn() }));
vi.mock("./draft-interpreter", () => ({ interpretTripMessage: deps.interpreter }));
vi.mock("../db", () => ({ createServiceClient: () => ({ from: deps.from }) }));
import { DEFAULT_POLICY, PlanningStateSchema, type TripMessage, type TravelerRecord, type DraftIntent } from "@repo/types";
import { applyDraftChanges, blankTripCard, transitionTrip } from "@repo/core";
import { editDraftCard, sendDraftMessage, validateDraft } from "./trip-drafts";
import type { TripStore } from "./store";

const owner = "11111111-1111-4111-8111-111111111111", trip = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const person: TravelerRecord = { id: owner, owner_id: owner, full_name: "Alice Martin", email: "alice@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" };
let history: TripMessage[];
function fixture(complete = true) {
  const date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const card = complete ? applyDraftChanges(blankTripCard(DEFAULT_POLICY, [owner], "fr"), [{ field: "destination", value: "Berlin", traveler_id: null }, { field: "meeting_date", value: date, traveler_id: null }, { field: "meeting_start", value: "10:00", traveler_id: null }], [person], "Stated") : blankTripCard(DEFAULT_POLICY, [], "fr");
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const state = { trip: { id: trip, owner_id: owner, status: "awaiting_request_confirmation", card }, directory: [person], workflow: PlanningStateSchema.parse({}) };
  const store = { id: trip, owner, token: key, state, db: { rpc }, audit: vi.fn(), next: (status: Parameters<typeof transitionTrip>[1]) => transitionTrip("awaiting_request_confirmation", status) } as unknown as TripStore;
  return { store, rpc };
}
beforeEach(() => {
  vi.clearAllMocks(); history = [];
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn() };
  chain.order.mockImplementation(() => ({ ...chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: history, error: null }).then(resolve) }));
  deps.from.mockReturnValue(chain);
});
describe("draft persistence and validation boundary", () => {
  it("rejects stale revisions before asking the model or writing", async () => {
    const { store, rpc } = fixture();
    await expect(sendDraftMessage(store, "retour demain", key, 9)).rejects.toThrow(/another tab/);
    expect(deps.interpreter).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps a vague request in the conversation without changing the card", async () => {
    const { store, rpc } = fixture();
    deps.interpreter.mockResolvedValue({ intent: "clarify", changes: [], confidence: .2, language: "fr", clarification: { question: "Quel retour ?", options: ["Le soir même", "Le lendemain matin"] } } satisfies DraftIntent);
    await sendDraftMessage(store, "je veux changer le retour", key, 0);
    const args = rpc.mock.calls[0][1];
    expect(args.p_card.return).toEqual(store.state.trip.card!.return); expect(args.p_card.notes).toEqual([]);
    expect(args.p_messages[1].quick_replies).toHaveLength(2); expect(args.p_changes).toEqual({});
  });
  it("saves inline edits and their confirmations in the same transaction", async () => {
    const { store, rpc } = fixture();
    await editDraftCard(store, [{ field: "meeting_start", value: "14:00", traveler_id: null }], key, 0);
    const args = rpc.mock.calls[0][1];
    expect(args.p_card.meeting_end.value).toBe("16:00"); expect(args.p_messages.map((m: TripMessage) => m.role)).toEqual(["system", "agent"]);
    expect(args.p_messages[0].content).toContain("Edited in the card"); expect(args.p_changes).toEqual({});
  });
  it("names missing fields and never transitions on incomplete validation", async () => {
    const { store, rpc } = fixture(false);
    expect(await validateDraft(store, 0, key)).toBe(false);
    const args = rpc.mock.calls[0][1];
    expect(args.p_changes).toEqual({}); expect(args.p_messages[1].content).toContain("date de réunion");
  });
  it("only explicit validation writes the availability checkpoint and its timeline event", async () => {
    const { store, rpc } = fixture();
    expect(await validateDraft(store, 0, key)).toBe(true);
    const args = rpc.mock.calls[0][1];
    expect(args.p_changes.trip.status).toBe("checking_availability");
    expect(args.p_changes.trip.workflow.coordination.meeting_checked).toBe(true);
    expect(args.p_changes.trip.workflow.searches).toEqual({});
    expect(args.p_changes.events[0]).toMatchObject({ actor: "manager", title: "Travel request validated" });
    expect(args.p_card.validated_at).toBeTruthy();
  });
  it("recognizes a retried message before checking its obsolete revision", async () => {
    const { store, rpc } = fixture();
    history = [{ id: key, trip_id: trip, owner_id: owner, role: "user", content: "initial request", created_at: new Date().toISOString(), quick_replies: [] }];
    expect(await sendDraftMessage(store, "initial request", key, 99)).toBe(false);
    expect(deps.interpreter).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps an explicit landing deselection even when the model names that traveler", async () => {
    const { store, rpc } = fixture(false);
    deps.interpreter.mockResolvedValue({ intent: "edit", confidence: 1, language: "fr", changes: [{ field: "add_traveler", value: owner, traveler_id: owner }], clarification: null });
    await sendDraftMessage(store, "Alice à Berlin", key, 0, true, { [owner]: false });
    expect(rpc.mock.calls[0][1].p_card.travelers.value).toEqual([]);
  });
});
