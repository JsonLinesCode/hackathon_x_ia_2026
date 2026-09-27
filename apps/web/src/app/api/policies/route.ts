import { PolicyRulesSchema, PolicySchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkDatabase, checkOrigin, handleApi, HttpError, json, readJson } from "@/server/http";

export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db.from("policies").select("*").eq("owner_id", user.id).maybeSingle();
    checkDatabase(error);
    if (!data) throw new HttpError(503, "Your policy has not been initialized. Run the foundation migration, then sign in again.");
    return json(PolicySchema.parse(data));
  });
}
export async function PATCH(request: Request) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const rules = PolicyRulesSchema.parse(await readJson(request));
    const { data, error } = await db.from("policies").update({ rules }).eq("owner_id", user.id).select().maybeSingle();
    checkDatabase(error);
    if (!data) throw new HttpError(503, "Your policy has not been initialized. Run the foundation migration, then sign in again.");
    return json(PolicySchema.parse(data));
  });
}
