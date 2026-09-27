import { requireUser } from "@/server/auth";
import { checkOrigin, handleApi, json } from "@/server/http";
import { syncOwner } from "@/server/agent/sync";
export const maxDuration = 300;
export async function POST(request: Request) {
  return handleApi(async () => { const { user } = await requireUser(); checkOrigin(request); return json(await syncOwner(user.id)); });
}
