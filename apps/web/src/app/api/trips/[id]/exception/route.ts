import { z } from "zod";
import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";
import { loadTrip, publicTrip, withTrip } from "@/server/agent/store";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user } = await requireUser(); checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = z.object({ approved: z.literal(true), note: z.string().trim().max(2000).optional() }).strict().parse(await readJson(request));
    await withTrip(user.id, id, async (store) => {
      const option = store.state.options.find((o) => o.selected);
      if (!option || store.state.trip.status !== "awaiting_exception") throw new HttpError(409, "No policy exception is awaiting approval.");
      await store.save({ trip: { status: store.next("awaiting_travelers") },
        options: store.state.options.map((o) => o.id === option.id ? { ...o, exception_approved: true, exception_note: input.note || null } : o),
        events: [{ actor: "manager", title: "Policy exception approved", detail: input.note || "External approval confirmed by the manager.", data: { option_id: option.id, violations: option.violations } }] });
    });
    return json(publicTrip(await loadTrip(user.id, id)));
  });
}
