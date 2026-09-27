import { NextResponse } from "next/server";
import { DEFAULT_POLICY } from "@repo/types";
import { createServiceClient, createUserClient } from "@/server/db";
import { GOOGLE_SCOPES } from "@/server/auth";
import { getEnv } from "@/server/env";
import { checkDatabase, handleApi } from "@/server/http";

export async function GET(request: Request) {
  return handleApi(async () => {
    const { APP_URL } = getEnv(["APP_URL"]);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code) {
      return NextResponse.redirect(new URL("/login?error=consent", APP_URL));
    }
    const db = await createUserClient();
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (error || !data.session) return NextResponse.redirect(new URL("/login?error=callback", APP_URL));
    const { data: verified, error: verificationError } = await db.auth.getUser();
    if (verificationError || !verified.user) return NextResponse.redirect(new URL("/login?error=callback", APP_URL));
    const user = verified.user;
    const service = createServiceClient();
    const profile = await service.from("profiles").upsert({
      id: user.id, email: user.email ?? "",
      full_name: user.user_metadata.full_name ?? user.user_metadata.name ?? "",
    }, { onConflict: "id" });
    checkDatabase(profile.error);
    const policy = await service.from("policies").upsert({
      owner_id: user.id, rules: DEFAULT_POLICY,
    }, { onConflict: "owner_id", ignoreDuplicates: true });
    checkDatabase(policy.error);
    const token = data.session.provider_refresh_token;
    if (!token) {
      return NextResponse.redirect(new URL("/profile?connection=missing_refresh_token", APP_URL));
    }
    const credential = await service.from("google_credentials").upsert({
      user_id: user.id, refresh_token: token, scopes: [...GOOGLE_SCOPES],
      updated_at: new Date().toISOString(), invalidated_at: null,
    }, { onConflict: "user_id" });
    checkDatabase(credential.error);
    const response = NextResponse.redirect(new URL("/", APP_URL));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  });
}
