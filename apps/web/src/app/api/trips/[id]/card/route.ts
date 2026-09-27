import { IdSchema, CardEditInputSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip } from "@/server/agent/store";
import { draftView, editDraftCard } from "@/server/agent/trip-drafts";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = CardEditInputSchema.parse(await readJson(request));
    await withTrip(user.id, id, (store) => editDraftCard(store, input.changes, input.idempotency_key, input.revision));
    return json(await draftView(user.id, id));
  });
}
