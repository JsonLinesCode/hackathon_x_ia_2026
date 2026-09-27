import { requireUser, GOOGLE_SCOPES } from "@/server/auth";
import { createServiceClient } from "@/server/db";
import { checkDatabase, handleApi, json } from "@/server/http";

export async function GET() {
  return handleApi(async () => {
    const { db, user } = await requireUser();
    const profile = await db.from("profiles").select("email, full_name").eq("id", user.id).maybeSingle();
    checkDatabase(profile.error);
    const credential = await createServiceClient().from("google_credentials")
      .select("scopes, updated_at, invalidated_at").eq("user_id", user.id).maybeSingle();
    checkDatabase(credential.error);
    const scopes: string[] = credential.data?.scopes ?? [];
    return json({
      email: profile.data?.email ?? user.email,
      full_name: profile.data?.full_name ?? user.user_metadata.full_name ?? "",
      google_connected: Boolean(credential.data && !credential.data.invalidated_at
        && GOOGLE_SCOPES.every((scope) => scopes.includes(scope))),
      connected_at: credential.data?.updated_at ?? null,
    });
  });
}
