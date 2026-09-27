import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deps = vi.hoisted(() => ({ searchFlights: vi.fn(), searchHotels: vi.fn(), extractRequest: vi.fn(), explainOptions: vi.fn() }));
vi.mock("../integrations/jinko", () => ({ withJinko: async (_audit: unknown, work: (client: typeof deps) => Promise<unknown>) => work(deps) }));
vi.mock("../integrations/openai", () => ({ extractRequest: deps.extractRequest, explainOptions: deps.explainOptions }));
import { DEFAULT_POLICY, type TravelerRecord, type RequestExtraction } from "@repo/types";
import { applyDraftChanges, blankTripCard, cardToValidatedPlan, transitionTrip } from "@repo/core";
import { searchNext, understand } from "./flows/plan-trip";
import type { Changes, TripState, TripStore } from "./store";
const owner = "11111111-1111-4111-8111-111111111111", trip = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const directory: TravelerRecord[] = ["Josselin Martin", "Emma Durand"].map((full_name, i) => ({ id: `${i + 3}1111111-1111-4111-8111-111111111111`, owner_id: owner, full_name, email: full_name.split(" ")[0] + "@example.test", home_city: "Paris", home_airport: "CDG", preferences: { seat: "none", notes: "" }, calendar_access: "unknown", created_at: "2026-09-27T10:00:00Z" }));
  const card = applyDraftChanges(blankTripCard(DEFAULT_POLICY, directory.map((p) => p.id)), [
    { field: "destination", value: "Berlin", traveler_id: null }, { field: "meeting_date", value: "2026-10-06", traveler_id: null }, { field: "meeting_start", value: "10:00", traveler_id: null },
  ], directory, "Stated");
  const plan = cardToValidatedPlan(card, directory);
  const state = { trip: { id: trip, owner_id: owner, status: "searching", card: { ...card, validated_at: "2026-09-27T10:00:00Z" }, meeting: plan.meeting, extracted: plan.request, request_text: "Josselin Berlin mardi 10h", budget_per_traveler: null },
    workflow: plan.workflow, directory, travelers: directory.map((traveler) => ({ traveler_id: traveler.id, traveler, availability: null })), options: [] } as unknown as TripState;
  const saves: Changes[] = [];
  const store = { owner, id: trip, state, audit: vi.fn(), event: vi.fn(), policy: async () => DEFAULT_POLICY,
    next: (status: TripState["trip"]["status"]) => transitionTrip(state.trip.status, status),
    save: async (changes: Changes) => { saves.push(changes); if (changes.trip) { Object.assign(state.trip, changes.trip); if (changes.trip.workflow) state.workflow = changes.trip.workflow; } },
  } as unknown as TripStore;
  return { store, saves };
}
beforeEach(() => {
  vi.clearAllMocks();
  deps.searchFlights.mockResolvedValue({ flights: [], warnings: [], raw: {} });
  deps.searchHotels.mockResolvedValue({ hotels: [], warnings: [], raw: {} });
});
describe("Create trip search blocking guard", () => {
  it("completes all traveler searches with empty inventory without needs_info or a required action", async () => {
    const { store, saves } = fixture();
    store.state.workflow.journey!.unsupported_constraints = ["Train only", "vegetarian"];
    await searchNext(store); await searchNext(store); await searchNext(store);
    expect(deps.searchFlights).toHaveBeenCalledTimes(2); expect(deps.searchHotels).toHaveBeenCalledTimes(2);
    expect(saves.flatMap((s) => s.trip?.status ? [s.trip.status] : [])).toEqual(["options_ready"]);
    expect(saves.flatMap((s) => s.actions ?? [])).toEqual([]);
    expect(saves.at(-1)?.options).toEqual([]); expect(store.state.trip.extracted?.missingFields).toEqual([]);
    expect(deps.explainOptions).not.toHaveBeenCalled();
  });
  it("cannot turn model-authored optional questions into needs_info through request resolution", async () => {
    const { store, saves } = fixture(); store.state.trip.status = "understanding";
    deps.extractRequest.mockResolvedValue({ title: "Berlin", destination: "Berlin", language: "fr", travelers: [{ name: "Josselin", email: null, home_city: null, home_airport: null }],
      meeting: { title: "Meeting", date: "2026-10-06", end_date: null, start_time: "10h", end_time: null, timezone: "", location: "" },
      budget_per_traveler: 0, total_budget: null, constraints: ["vegetarian"], missingFields: ["Clarify train and dietary needs"],
      journey: { ...store.state.workflow.journey!, departure_date: null, return_date: null, hotel_needed: null, unsupported_constraints: ["train"] },
    } satisfies RequestExtraction);
    await understand(store);
    expect(saves.at(-1)?.trip?.status).toBe("checking_availability");
    expect(store.state.trip.extracted?.missingFields).toEqual([]);
  });
});
