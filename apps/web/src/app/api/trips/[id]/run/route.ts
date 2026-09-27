import { z } from "zod";
import { IdSchema } from "@repo/types";
import { transitionTrip } from "@repo/core";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { runTrip } from "@/server/agent/orchestrator";
import { loadTrip, publicTrip, withTrip } from "@/server/agent/store";
import { HttpError } from "@/server/http";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ retry: z.boolean().default(false), research: z.boolean().default(false) }).strict().parse(await readJson(request));
    if (input.research) {
      await withTrip(user.id, id, async (store) => {
        if (!["options_ready", "awaiting_exception", "awaiting_travelers", "ready_to_book", "booking"].includes(store.state.trip.status) ||
          store.state.actions.some((a) => a.status === "executing" || (a.kind === "book" && ["executed", "failed"].includes(a.status)))) throw new HttpError(409, "Existing quotes must be reconciled before restarting. Create a new trip if needed.");
        // Return via the defined graph; invalidates approvals and confirmations.
        if (store.state.trip.status !== "options_ready") store.next("options_ready");
        await store.save({ reset_plan: true, trip: { status: transitionTrip("options_ready", "searching"),
          workflow: { ...store.state.workflow, searches: {}, error: null, attempt: store.state.workflow.attempt + 1 } },
          events: [{ actor: "manager", title: "Fresh search requested", detail: "Previous options, confirmations and unused approvals were invalidated." }] });
      });
    } else await runTrip(user.id, id, input.retry);
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
