import { IdSchema, TravelerInputSchema, TravelerRecordSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkDatabase, checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const input = TravelerInputSchema.parse(await readJson(request));
    const { data, error } = await db.from("travelers").update(input).eq("id", id).eq("owner_id", user.id).select().maybeSingle();
    checkDatabase(error);
    if (!data) throw new HttpError(404, "Traveler not found.");
    return json(TravelerRecordSchema.parse(data));
  });
}
export async function DELETE(request: Request, context: Context) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const id = IdSchema.parse((await context.params).id);
    const { data, error } = await db.from("travelers").delete().eq("id", id).eq("owner_id", user.id).select("id").maybeSingle();
    checkDatabase(error);
    if (!data) throw new HttpError(404, "Traveler not found.");
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  });
}
