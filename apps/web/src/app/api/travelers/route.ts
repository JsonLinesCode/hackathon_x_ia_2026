import { TravelerInputSchema, TravelerRecordSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { checkDatabase, checkOrigin, handleApi, json, readJson } from "@/server/http";

export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db.from("travelers").select("*").eq("owner_id", user.id).order("created_at");
    checkDatabase(error);
    return json(TravelerRecordSchema.array().parse(data));
  });
}
export async function POST(request: Request) {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    checkOrigin(request);
    const input = TravelerInputSchema.parse(await readJson(request));
    const { data, error } = await db.from("travelers").insert({ ...input, owner_id: user.id }).select().single();
    checkDatabase(error);
    return json(TravelerRecordSchema.parse(data), 201);
  });
}
