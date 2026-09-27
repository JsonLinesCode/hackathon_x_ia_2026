import { sendDraftMessage } from "@/server/agent/trip-drafts";
import { randomUUID } from "node:crypto";
import { CreateTripSchema, TripSchema, PlanningStateSchema, PolicyRulesSchema } from "@repo/types";
import { blankTripCard, transitionTrip } from "@repo/core";
import { requireUser } from "@/server/auth";
import { createServiceClient } from "@/server/db";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { planningDatabase, withTrip } from "@/server/agent/store";

export const maxDuration = 300;

export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const [trips, people, actions] = await Promise.all([
      db.from("trips").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }),
      db.from("trip_travelers").select("trip_id,traveler_id").eq("owner_id", user.id),
      db.from("actions").select("trip_id,status").eq("owner_id", user.id).eq("status", "proposed"),
    ]);
    [trips, people, actions].forEach((r) => planningDatabase(r.error));
    return json(TripSchema.array().parse(trips.data).map((trip) => ({ ...trip,
      traveler_count: trip.status === "awaiting_request_confirmation" ? trip.card?.travelers.value.length ?? 0 : people.data?.filter((p) => p.trip_id === trip.id).length ?? 0,
      pending_decisions: actions.data?.filter((a) => a.trip_id === trip.id).length ?? 0,
    })));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const input = CreateTripSchema.parse(await readJson(request));
    const ids = [...new Set(input.traveler_ids)];
    if (ids.length) {
      const people = await db.from("travelers").select("id").eq("owner_id", user.id).in("id", ids);
      planningDatabase(people.error);
      if (people.data?.length !== ids.length) throw new HttpError(400, "Choose travelers from your workspace.");
    }
    const service = createServiceClient();
    const existing = await service.from("trips").select("*").eq("owner_id", user.id).eq("creation_key", input.idempotency_key).maybeSingle();
    planningDatabase(existing.error);
    if (existing.data) {
      const trip = TripSchema.parse(existing.data);
      if (trip.status === "awaiting_request_confirmation") await withTrip(user.id, trip.id, (store) => sendDraftMessage(store, input.request_text, input.idempotency_key, 0, true, input.traveler_overrides));
      return json(trip);
    }
    const policy = await db.from("policies").select("rules").eq("owner_id", user.id).single();
    planningDatabase(policy.error);
    const created = await service.from("trips").insert({
      id: randomUUID(), owner_id: user.id, title: "New trip", request_text: input.request_text,
      card: blankTripCard(PolicyRulesSchema.parse(policy.data?.rules), ids),
      status: transitionTrip("draft", "awaiting_request_confirmation"), creation_key: input.idempotency_key,
      workflow: PlanningStateSchema.parse({ traveler_ids: ids }),
    }).select().single();
    if (created.error?.code === "23505") {
      const duplicate = await service.from("trips").select("*").eq("owner_id", user.id).eq("creation_key", input.idempotency_key).single();
      planningDatabase(duplicate.error);
      return json(TripSchema.parse(duplicate.data));
    }
    planningDatabase(created.error);
    const trip = TripSchema.parse(created.data);
    await withTrip(user.id, trip.id, (store) => sendDraftMessage(store, input.request_text, input.idempotency_key, 0, true, input.traveler_overrides));
    return json(trip, 201);
  });
}
