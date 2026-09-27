import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json, readJson } from "@/server/http";
import { withTrip } from "@/server/agent/store";
import { draftView, validateDraft } from "@/server/agent/trip-drafts";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ revision: z.number().int().nonnegative(), idempotency_key: IdSchema }).strict().parse(await readJson(request));
    await withTrip(user.id, id, (store) => validateDraft(store, input.revision, input.idempotency_key));
    return json(await draftView(user.id, id));
  });
}
