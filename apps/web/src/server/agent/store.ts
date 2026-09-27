import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionSchema, BookingSchema, PlanningStateSchema, PolicyRulesSchema, TripSchema, TripOptionSchema, TripTravelerSchema, TravelerRecordSchema, TimelineEventSchema, BookingDetailsSchema, type Action, type Booking, type Trip, type TripOption, type PlanningState, type PlanTraveler, type TimelineEvent } from "@repo/types";
import { transitionTrip } from "@repo/core";
import { createServiceClient } from "../db";
import { checkDatabase, HttpError } from "../http";

export type EventInput = { actor?: TimelineEvent["actor"]; source?: string; title: string; detail?: string; data?: Record<string, unknown> };
type TravelerChange = { traveler_id: string; confirmation_status?: PlanTraveler["confirmation_status"]; response_text?: string | null; booking_details?: PlanTraveler["booking_details"] };
export type Changes = {
  trip?: Partial<Trip> & { workflow?: PlanningState };
  options?: TripOption[]; actions?: Action[]; bookings?: Booking[];
  travelers?: TravelerChange[]; events?: EventInput[]; reset_plan?: boolean; replace_travelers?: boolean;
};
export function planningDatabase(error: { code?: string; message?: string } | null) {
  if (error && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    throw new HttpError(503, "Phase 2 database setup is incomplete. Run supabase/migrations/0002_planning.sql after 0001_foundation.sql.");
  }
  if (error?.code === "P0001") throw new HttpError(409, "This trip changed or another step is running. Refresh before trying again.");
  checkDatabase(error);
}
export async function loadTrip(owner: string, id: string) {
  const db = createServiceClient();
  const tripResult = await db.from("trips").select("*").eq("owner_id", owner).eq("id", id).maybeSingle();
  planningDatabase(tripResult.error);
  if (!tripResult.data) throw new HttpError(404, "Trip not found.");
  if (!Object.hasOwn(tripResult.data, "workflow")) throw new HttpError(503, "Run supabase/migrations/0002_planning.sql in Supabase.");
  const [people, options, actions, bookings, timeline, directory, leases] = await Promise.all([
    db.from("trip_travelers").select("*").eq("owner_id", owner).eq("trip_id", id),
    db.from("trip_options").select("*").eq("owner_id", owner).eq("trip_id", id).order("rank"),
    db.from("actions").select("*").eq("owner_id", owner).eq("trip_id", id),
    db.from("bookings").select("*").eq("owner_id", owner).eq("trip_id", id),
    db.from("timeline_events").select("*").eq("owner_id", owner).eq("trip_id", id).order("at").limit(1000),
    db.from("travelers").select("*").eq("owner_id", owner),
    db.from("trip_leases").select("expires_at").eq("owner_id", owner).eq("trip_id", id).maybeSingle(),
  ]);
  [people, options, actions, bookings, timeline, directory, leases].forEach((result) => planningDatabase(result.error));
  const records = TravelerRecordSchema.array().parse(directory.data);
  const travelers: PlanTraveler[] = z.array(TripTravelerSchema.extend({ booking_details: BookingDetailsSchema.nullable() })).parse(people.data)
    .map((person) => {
      const traveler = records.find((t) => t.id === person.traveler_id);
      if (!traveler) throw new HttpError(409, "A traveler record is unavailable.");
      return { ...person, traveler };
    });
  return {
    trip: TripSchema.parse(tripResult.data), workflow: PlanningStateSchema.parse(tripResult.data.workflow),
    travelers, directory: records,
    options: TripOptionSchema.array().parse(options.data), actions: ActionSchema.array().parse(actions.data),
    bookings: BookingSchema.array().parse(bookings.data), timeline: TimelineEventSchema.array().parse(timeline.data),
    running: !!leases.data && Date.parse(leases.data.expires_at) > Date.now(),
  };
}
export type TripState = Awaited<ReturnType<typeof loadTrip>>;
export function publicTrip(state: TripState) {
  return {
    trip: state.trip, journey: state.workflow.journey, travelers: state.travelers, options: state.options,
    bookings: state.bookings.map((booking) => { const publicBooking = { ...booking }; Reflect.deleteProperty(publicBooking, "raw"); return publicBooking; }),
    actions: state.actions.map((action) => ({ ...action, result: action.result ? {
      stage: action.result.stage, provider_trip_id: action.result.provider_trip_id,
      error: action.result.error, checkout_url: action.result.checkout_url,
      expires_at: action.result.expires_at, quote_total_eur: action.result.quote_total_eur,
    } : null })),
    timeline: state.timeline, workflow_error: state.workflow.error, running: state.running,
  };
}
export class TripStore {
  readonly db = createServiceClient();
  constructor(readonly owner: string, readonly id: string, readonly token: string, public state: TripState) {}
  async save(changes: Changes) {
    const { error } = await this.db.rpc("phase2_commit", { p_trip: this.id, p_owner: this.owner, p_token: this.token, p_changes: changes });
    planningDatabase(error);
    // Reload after a commit so subsequent decisions always use persisted state.
    this.state = await loadTrip(this.owner, this.id);
  }
  async event(title: string, detail = "", data: Record<string, unknown> = {}, source = "planner", actor: EventInput["actor"] = "agent") {
    // Independent external calls can append events concurrently; each event is
    // owner-scoped and does not overwrite a workflow checkpoint.
    const { error } = await this.db.from("timeline_events").insert({ owner_id: this.owner, trip_id: this.id, title, detail, data, source, actor });
    planningDatabase(error);
  }
  audit = (title: string, detail = "", data: Record<string, unknown> = {}) => this.event(title, detail, data, title.startsWith("OpenAI") ? "openai" : "jinko", "provider");
  next(status: Trip["status"]) { return transitionTrip(this.state.trip.status, status); }
  async policy() {
    const { data, error } = await this.db.from("policies").select("rules").eq("owner_id", this.owner).single();
    planningDatabase(error);
    return PolicyRulesSchema.parse(data?.rules);
  }
}
export async function withTrip<T>(owner: string, id: string, work: (store: TripStore) => Promise<T>) {
  await loadTrip(owner, id); // Ownership check before claiming the service-only lease.
  const db = createServiceClient();
  const token = randomUUID();
  const claim = await db.rpc("phase2_claim", { p_trip: id, p_owner: owner, p_token: token });
  planningDatabase(claim.error);
  if (!claim.data) throw new HttpError(409, "A step is already running for this trip. Please wait.");
  try { return await work(new TripStore(owner, id, token, await loadTrip(owner, id))); }
  finally {
    const released = await db.rpc("phase2_release", { p_trip: id, p_owner: owner, p_token: token });
    planningDatabase(released.error);
  }
}
