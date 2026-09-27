import { requireUser } from "@/server/auth";
import { handleApi, json } from "@/server/http";
import { loadTrip, publicTrip, planningDatabase } from "@/server/agent/store";
export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const result = await db.from("trips").select("id").eq("owner_id", user.id).not("workflow->>disruption", "is", null).order("updated_at", { ascending: false }).limit(20);
    planningDatabase(result.error);
    const trips = await Promise.all((result.data ?? []).map(async (t) => publicTrip(await loadTrip(user.id, t.id))));
    return json(trips.filter((t) => t.disruption));
  });
}
