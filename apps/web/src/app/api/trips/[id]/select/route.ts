import { z } from "zod";
import { IdSchema } from "@repo/types";
import { effectivePolicy, evaluatePolicy } from "@repo/core";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { loadTrip, publicTrip, withTrip } from "@/server/agent/store";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const { option_id } = z.object({ option_id: IdSchema }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      if (store.state.trip.status !== "options_ready") throw new HttpError(409, "An option has already been selected. Search again to choose a new plan.");
      const chosen = store.state.options.find((o) => o.id === option_id);
      if (!chosen) throw new HttpError(404, "Option not found for this trip.");
      const evaluated = evaluatePolicy({ id: chosen.id, per_traveler: chosen.per_traveler, meeting_start: store.state.trip.meeting?.start ?? null },
        effectivePolicy(await store.policy(), store.state.trip.budget_per_traveler));
      await store.save({
        trip: { status: store.next(evaluated.compliant ? "awaiting_travelers" : "awaiting_exception") },
        options: store.state.options.map((o) => o.id === chosen.id ? { ...o, ...evaluated, selected: true } : { ...o, selected: false }),
        events: [{ actor: "manager", title: "Option selected", detail: chosen.label, data: { option_id, compliant: evaluated.compliant } }],
      });
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
