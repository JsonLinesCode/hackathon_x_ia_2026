import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { withTrip, publicTrip, loadTrip } from "@/server/agent/store";
import { applyReply } from "@/server/agent/flows/confirmations";
import { replanTraveler } from "@/server/agent/flows/counter-proposal";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ traveler_id: IdSchema, decision: z.enum(["confirmed", "declined", "replan"]), message: z.string().max(4000).default("") }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      if (input.decision === "replan") { await replanTraveler(store, input.traveler_id, input.message || undefined); return; }
      const outreach = store.state.outreach.find((o) => o.traveler_id === input.traveler_id && o.purpose === "trip_confirmation" && o.metadata.option_id === store.state.options.find((a) => a.selected)?.id);
      if (!outreach) throw new HttpError(404, "Current confirmation not found.");
      await applyReply(store, outreach, { decision: input.decision, message: input.message || "Response reviewed by the manager." }, "manager");
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
