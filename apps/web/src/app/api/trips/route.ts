import { randomUUID } from "node:crypto";
import { CreateTripSchema, TripSchema, PlanningStateSchema } from "@repo/types";
import { transitionTrip } from "@repo/core";
import { requireUser } from "@/server/auth";
import { createServiceClient } from "@/server/db";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { planningDatabase, withTrip } from "@/server/agent/store";

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
      traveler_count: people.data?.filter((p) => p.trip_id === trip.id).length ?? 0,
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
    if (existing.data) return json(TripSchema.parse(existing.data));
    const created = await service.from("trips").insert({
      id: randomUUID(), owner_id: user.id, title: "New trip", request_text: input.request_text,
      status: transitionTrip("draft", "understanding"), creation_key: input.idempotency_key,
      workflow: PlanningStateSchema.parse({ traveler_ids: ids }),
    }).select().single();
    if (created.error?.code === "23505") {
      const duplicate = await service.from("trips").select("*").eq("owner_id", user.id).eq("creation_key", input.idempotency_key).single();
      planningDatabase(duplicate.error);
      return json(TripSchema.parse(duplicate.data));
    }
    planningDatabase(created.error);
    const trip = TripSchema.parse(created.data);
    await withTrip(user.id, trip.id, (store) => store.save({ events: [{ actor: "manager", title: "Trip requested", detail: input.request_text }] }));
    return json(trip, 201);
  });
}
