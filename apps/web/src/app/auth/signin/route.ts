import { NextResponse } from "next/server";
import { createUserClient } from "@/server/db";
import { getEnv, EnvironmentError } from "@/server/env";
import { GOOGLE_SCOPES } from "@/server/auth";
import { checkOrigin, handleApi, HttpError } from "@/server/http";

export async function POST(request: Request) {
  return handleApi(async () => {
    checkOrigin(request);
    try {
      const { APP_URL } = getEnv(["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
      const db = await createUserClient();
      const { data, error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: {
          scopes: GOOGLE_SCOPES.join(" "), redirectTo: APP_URL + "/auth/callback",
          queryParams: { access_type: "offline", prompt: "consent" },
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url) {
        return NextResponse.redirect(new URL("/login?error=signin", APP_URL), 303);
      }
      return NextResponse.redirect(data.url, 303);
    } catch (error) {
      if (error instanceof EnvironmentError) throw error;
      throw new HttpError(502, "Google sign-in is unavailable. Check your Supabase Google provider configuration.");
    }
  });
}
