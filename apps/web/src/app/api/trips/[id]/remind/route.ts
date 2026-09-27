import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip, publicTrip, loadTrip } from "@/server/agent/store";
import { remind } from "@/server/agent/flows/confirmations";
import { runStep } from "@/server/agent/orchestrator";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ traveler_id: IdSchema }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => { await remind(store, input.traveler_id); await runStep(store); });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
