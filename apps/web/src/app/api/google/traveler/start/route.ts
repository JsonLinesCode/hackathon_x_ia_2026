import { randomUUID, randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { signLink } from "@repo/core";
import { getEnv } from "@/server/env";
import { createServiceClient } from "@/server/db";
import { handleApi } from "@/server/http";
import { planningDatabase } from "@/server/agent/store";
import { verifyOutreach } from "@/server/traveler-links";
import { googleOAuth } from "@/server/integrations/google-auth";
export async function GET(request: Request) {
  return handleApi(async () => {
    const { outreach, person } = await verifyOutreach(new URL(request.url).searchParams.get("token") ?? "", "calendar_access");
    const client = googleOAuth();
    const pkce = await client.generateCodeVerifierAsync();
    const id = randomUUID(), nonce = randomBytes(32).toString("base64url"), expires = Date.now() + 10 * 60000;
    planningDatabase((await createServiceClient().from("traveler_oauth_states").insert({
      id, owner_id: outreach.owner_id, trip_id: outreach.trip_id, traveler_id: person.traveler_id, outreach_id: outreach.id,
      verifier: pkce.codeVerifier, cookie_hash: createHash("sha256").update(nonce).digest("hex"), expires_at: new Date(expires).toISOString(),
    })).error);
    const state = await signLink({ purpose: "google_oauth_state", id, exp: Math.floor(expires / 1000) }, getEnv(["APP_SECRET"]).APP_SECRET);
    const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", state,
      scope: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
      login_hint: person.traveler.email, code_challenge: pkce.codeChallenge,
      code_challenge_method: "S256" as import("google-auth-library").CodeChallengeMethod });
    const response = NextResponse.redirect(url);
    response.cookies.set("tm_traveler_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: new URL(getEnv(["APP_URL"]).APP_URL).protocol === "https:",
      path: "/api/google/traveler", maxAge: 600 });
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
}
