import { IdSchema, DraftMessageInputSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip } from "@/server/agent/store";
import { draftView, sendDraftMessage } from "@/server/agent/trip-drafts";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = DraftMessageInputSchema.parse(await readJson(request));
    await withTrip(user.id, id, (store) => sendDraftMessage(store, input.content, input.idempotency_key, input.revision));
    return json(await draftView(user.id, id));
  });
}
export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser();
    return json(await draftView(user.id, IdSchema.parse((await context.params).id)));
  });
}
