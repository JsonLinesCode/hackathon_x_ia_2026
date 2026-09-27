import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { loadTrip, planningDatabase, publicTrip, withTrip } from "@/server/agent/store";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser();
    const id = IdSchema.parse((await context.params).id);
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
export async function PATCH(request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ request_text: z.string().trim().min(10).max(12000) }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      if (store.state.trip.status !== "needs_info") throw new HttpError(409, "The request can only be clarified while information is missing.");
      await store.save({ reset_plan: true, trip: { request_text: input.request_text, status: store.next("understanding"),
        workflow: { ...store.state.workflow, searches: {}, error: null, attempt: store.state.workflow.attempt + 1 } },
        events: [{ actor: "manager", title: "Request clarified", detail: input.request_text }] });
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    await withTrip(user.id, id, async (store) => {
      if (store.state.trip.status !== "awaiting_request_confirmation") throw new HttpError(409, "Only unvalidated drafts can be deleted.");
      const result = await store.db.from("trips").delete().eq("owner_id", user.id).eq("id", id).eq("status", "awaiting_request_confirmation");
      planningDatabase(result.error);
    });
    return json({ deleted: true });
  });
}
