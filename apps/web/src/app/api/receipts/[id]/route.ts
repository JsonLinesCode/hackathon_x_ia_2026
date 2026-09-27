import { IdSchema } from "@repo/types";
import { requireUser } from "@/server/auth";
import { handleApi, HttpError, checkDatabase } from "@/server/http";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    const { user, db } = await requireUser();
    const id = IdSchema.parse((await context.params).id);
    const found = await db.from("receipts").select("path,file_name").eq("owner_id", user.id).eq("id", id).maybeSingle();
    checkDatabase(found.error); if (!found.data) throw new HttpError(404, "Receipt not found.");
    const result = await db.storage.from("receipts").createSignedUrl(found.data.path, 60, { download: found.data.file_name });
    if (result.error || !result.data) throw new HttpError(502, "The private receipt is not available.");
    return new Response(null, { status: 302, headers: { Location: result.data.signedUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  });
}
