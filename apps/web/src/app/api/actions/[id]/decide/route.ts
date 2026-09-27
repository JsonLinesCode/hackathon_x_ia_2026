import { z } from "zod";
import { IdSchema } from "@repo/types";
import { assertBookingReady, classifyAction } from "@repo/core";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { planningDatabase, loadTrip, publicTrip, withTrip } from "@/server/agent/store";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { db, user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ decision: z.enum(["approve", "reject"]) }).strict().parse(await readJson(request));
    const found = await db.from("actions").select("trip_id").eq("owner_id", user.id).eq("id", id).maybeSingle();
    planningDatabase(found.error);
    if (!found.data) throw new HttpError(404, "Action not found.");
    const tripId: string = found.data.trip_id;
    await withTrip(user.id, tripId, async (store) => {
      const action = store.state.actions.find((a) => a.id === id)!;
      const target = input.decision === "approve" ? "approved" : "rejected";
      if (action.status === target || (input.decision === "approve" && ["executing", "executed"].includes(action.status))) return;
      if (action.status !== "proposed" || classifyAction(action) !== "needs_manager") throw new HttpError(409, "This action no longer accepts a decision.");
      let siblings: typeof store.state.actions = [];
      if (action.kind === "book") {
        if (!["ready_to_book", "booking"].includes(store.state.trip.status)) throw new HttpError(409, "This quote is not ready.");
        const option = store.state.options.find((o) => o.selected && o.id === action.payload.option_id);
        if (!option) throw new HttpError(409, "The option for this action is no longer selected.");
        if (input.decision === "approve") assertBookingReady(option, store.state.travelers, new Date());
      } else {
        const d = store.state.workflow.disruption;
        if (!d || d.stage !== "waiting" || !d.action_ids.includes(action.id)) throw new HttpError(409, "Recovery action is not current.");
        if (input.decision === "approve") {
          if (action.payload.operation === "move_dates" && (!action.payload.journey || !action.payload.meeting)) throw new HttpError(409, "Enter new dates in the recovery panel first.");
          siblings = store.state.actions.filter((a) => d.action_ids.includes(a.id) && a.id !== action.id && a.status === "proposed")
            .map((a) => ({ ...a, status: "rejected", decided_at: new Date().toISOString() }));
        }
      }
      await store.save({ actions: [{ ...action, status: target, decided_at: new Date().toISOString() }, ...siblings],
        events: [{ actor: "manager", title: "Decision " + target, detail: action.summary,
          data: { action_id: action.id, decision: input.decision, cost_eur: action.cost_eur } }] });
    });
    return json(publicTrip(await loadTrip(user.id, tripId)));
  });
}
