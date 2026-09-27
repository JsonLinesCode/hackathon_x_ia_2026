import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyLink, escapeHtml } from "@repo/core";
import { getEnv } from "@/server/env";
import { createServiceClient } from "@/server/db";
import { HttpError } from "@/server/http";
import { planningDatabase, withTrip } from "@/server/agent/store";
import { googleOAuth } from "@/server/integrations/google-auth";
import { freeBusy } from "@/server/integrations/calendar";

function page(message: string, status = 200) {
  const response = new NextResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Travel Manager</title><body style="font:18px system-ui;margin:8vh auto;max-width:620px;padding:24px"><h1>Travel Manager</h1><p>' + escapeHtml(message) + "</p></body></html>",
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" } });
  response.cookies.set("tm_traveler_oauth", "", { path: "/api/google/traveler", maxAge: 0 });
  return response;
}
export async function GET(request: NextRequest) {
  try {
    const env = getEnv(["APP_SECRET", "GOOGLE_CLIENT_ID"]);
    const payload = await verifyLink(request.nextUrl.searchParams.get("state") ?? "", "google_oauth_state", env.APP_SECRET);
    const db = createServiceClient();
    const found = await db.from("traveler_oauth_states").select("*").eq("id", payload.id).is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    planningDatabase(found.error);
    const nonce = request.cookies.get("tm_traveler_oauth")?.value;
    if (!found.data || !nonce) throw new HttpError(400, "Consent session expired. Open the link from your email again.");
    const state = found.data;
    const expected = Buffer.from(state.cookie_hash, "hex"), actual = createHash("sha256").update(nonce).digest();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HttpError(400, "Consent session does not match this browser.");
    const consumed = await db.from("traveler_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", state.id).is("used_at", null).select("id");
    planningDatabase(consumed.error);
    if (!consumed.data?.length) throw new HttpError(400, "This consent session was already used.");
    if (request.nextUrl.searchParams.has("error")) {
      await withTrip(state.owner_id, state.trip_id, async (store) => {
        planningDatabase((await db.from("travelers").update({ calendar_access: "denied" }).eq("id", state.traveler_id).eq("owner_id", state.owner_id)).error);
        await store.event("Traveler calendar consent denied", "If the Google app is in Testing, add the traveler email as a test user in Google Cloud, then reopen the consent link.", { traveler_id: state.traveler_id }, "google", "traveler");
      });
      return page("Calendar access was not granted. If Google says access is blocked, ask your travel manager to add your email as a test user in Google Cloud, then reopen the email link.", 403);
    }
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new HttpError(400, "Google did not return an authorization code.");
    const client = googleOAuth();
    const { tokens } = await client.getToken({ code, codeVerifier: state.verifier });
    if (!tokens.id_token) throw new HttpError(400, "Google did not verify your identity. Reopen the consent link.");
    const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID })).getPayload();
    const traveler = await db.from("travelers").select("email").eq("id", state.traveler_id).eq("owner_id", state.owner_id).single();
    planningDatabase(traveler.error);
    if (!identity?.email_verified || identity.email?.toLowerCase() !== traveler.data?.email) throw new HttpError(403, "Use the Google account matching the traveler email that received this link.");
    const scopes = (tokens.scope ?? "").split(" ");
    if (!tokens.refresh_token || !scopes.includes("https://www.googleapis.com/auth/calendar.readonly")) throw new HttpError(400, "Read-only calendar consent and offline access are required. Revoke this app at myaccount.google.com/permissions and reopen the email link.");
    planningDatabase((await db.from("traveler_google_credentials").upsert({ traveler_id: state.traveler_id, refresh_token: tokens.refresh_token,
      scopes, invalidated_at: null, updated_at: new Date().toISOString() })).error);
    planningDatabase((await db.from("travelers").update({ calendar_access: "consented" }).eq("id", state.traveler_id).eq("owner_id", state.owner_id)).error);
    await withTrip(state.owner_id, state.trip_id, async (store) => {
      const journey = store.state.workflow.coordination.traveler_journeys[state.traveler_id] ?? store.state.workflow.journey;
      let availability: Record<string, unknown> | null = null;
      if (journey) {
        const start = (journey.departure_date ?? journey.hotel_checkin)! + "T00:00:00Z";
        const end = new Date(Date.parse((journey.return_date ?? journey.hotel_checkout ?? journey.departure_date)! + "T00:00:00Z") + 86400000).toISOString();
        const busy = await freeBusy(state.owner_id, traveler.data!.email, start, end, store.audit, state.traveler_id);
        availability = { checked_at: new Date().toISOString(), source: busy ? "consented" : "unknown", busy: busy ?? [], reason: busy ? null : "Calendar unavailable" };
      }
      const outreach = store.state.outreach.find((o) => o.id === state.outreach_id);
      await store.save({ travelers: [{ traveler_id: state.traveler_id, availability }], outreach: outreach ? [{ ...outreach, status: "responded" }] : [],
        events: [{ source: "google", actor: "traveler", title: "Traveler calendar connected", data: { traveler_id: state.traveler_id } }] });
    });
    return page("Thank you. Your calendar is connected with read-only access. Your travel manager can now check availability.");
  } catch (error) { return page(error instanceof HttpError ? error.message : "Calendar connection could not finish. Reopen the consent link or contact your travel manager.", error instanceof HttpError ? error.status : 400); }
}
