import { timingSafeEqual } from "node:crypto";
import { SimulationInputSchema, DisruptionEventSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { createServiceClient } from "@/server/db";
import { getEnv } from "@/server/env";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { loadTrip, planningDatabase } from "@/server/agent/store";
import { queueInbound } from "@/server/agent/sync";
import { processDisruptionInbound, deferred } from "@/server/agent/inbound";
export const maxDuration = 300;
export async function POST(request: Request) {
  return handleApi(async () => {
    const bearer = request.headers.get("authorization");
    let owner: string;
    if (bearer) {
      const expected = Buffer.from("Bearer " + getEnv(["SIMULATION_SECRET"]).SIMULATION_SECRET);
      const supplied = Buffer.from(bearer);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, "Invalid simulation credential.");
      owner = "";
    } else { const { user } = await requireUser(); checkOrigin(request); owner = user.id; }
    const input = SimulationInputSchema.parse(await readJson(request)), db = createServiceClient();
    if (bearer) {
      if (!input.owner_email) throw new HttpError(400, "owner_email is required with SIMULATION_SECRET.");
      const result = await db.from("profiles").select("id").eq("email", input.owner_email.toLowerCase()).maybeSingle(); planningDatabase(result.error);
      if (!result.data) throw new HttpError(404, "Manager account not found."); owner = result.data.id;
    }
    const trip = await loadTrip(owner, input.trip_id);
    if (input.kind.startsWith("flight_") && !trip.bookings.some((b) => b.id === input.booking_id && b.kind === "flight")) throw new HttpError(400, "Select the affected flight booking.");
    const payload = input.kind === "inbound_email" ? { trip_id: input.trip_id, subject: input.subject, body: input.body } : DisruptionEventSchema.parse(input);
    const kind = input.kind === "inbound_email" ? "simulated_email" : "travel_disruption";
    await queueInbound(owner, kind, "event:" + input.idempotency_key, payload);
    const saved = await db.from("inbound_events").select("*").eq("owner_id", owner).eq("dedupe_key", owner + ":event:" + input.idempotency_key).single(); planningDatabase(saved.error);
    if (saved.data!.processed_at) return json({ id: saved.data!.id, processed: true });
    try {
      await processDisruptionInbound(owner, saved.data!);
      planningDatabase((await db.from("inbound_events").update({ processed_at: new Date().toISOString() }).eq("owner_id", owner).eq("id", saved.data!.id)).error);
      return json({ id: saved.data!.id, processed: true });
    } catch (error) { if (!deferred(error)) throw error; return json({ id: saved.data!.id, processed: false, message: "Queued until the active step completes." }, 202); }
  });
}
