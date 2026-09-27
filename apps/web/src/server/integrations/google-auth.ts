import "server-only";
import { OAuth2Client } from "google-auth-library";
import { createServiceClient } from "../db";
import { getEnv } from "../env";
import { checkDatabase, HttpError } from "../http";
import type { Audit } from "./errors";

export class GoogleError extends HttpError {
  constructor(public googleStatus: number, message: string) { super(googleStatus === 401 ? 409 : 502, message); }
}
export function googleOAuth() {
  const env = getEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL"]);
  return new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.APP_URL + "/api/google/traveler/callback" });
}
export async function googleAccess(owner: string, travelerId?: string) {
  const db = createServiceClient();
  if (travelerId) {
    const person = await db.from("travelers").select("id").eq("id", travelerId).eq("owner_id", owner).maybeSingle();
    checkDatabase(person.error);
    if (!person.data) throw new HttpError(404, "Traveler not found.");
  }
  const table = travelerId ? "traveler_google_credentials" : "google_credentials";
  const field = travelerId ? "traveler_id" : "user_id";
  const credential = await db.from(table).select("refresh_token,invalidated_at").eq(field, travelerId ?? owner).maybeSingle();
  checkDatabase(credential.error);
  if (!credential.data || credential.data.invalidated_at) throw new GoogleError(401, travelerId
    ? "Traveler calendar access needs renewed consent." : "Reconnect Google in Settings before continuing.");
  const client = googleOAuth();
  client.setCredentials({ refresh_token: credential.data.refresh_token });
  try {
    const access = await client.getAccessToken();
    if (!access.token) throw new Error("No access token");
    return access.token;
  } catch (error) {
    const invalid = typeof error === "object" && error !== null && JSON.stringify(
      "response" in error ? (error.response as { data?: unknown })?.data : {}).includes("invalid_grant");
    if (invalid) {
      checkDatabase((await db.from(table).update({ invalidated_at: new Date().toISOString() }).eq(field, travelerId ?? owner)).error);
      if (travelerId) checkDatabase((await db.from("travelers").update({ calendar_access: "unknown" }).eq("id", travelerId).eq("owner_id", owner)).error);
    }
    throw new GoogleError(401, travelerId ? "Traveler calendar access needs renewed consent." : "Reconnect Google in Settings. The stored authorization is unavailable or expired.");
  }
}
export async function googleRequest<T>(owner: string, path: string, audit: Audit, options: { method?: string; body?: unknown; travelerId?: string; label: string }) {
  if (!path.startsWith("/gmail/v1/") && !path.startsWith("/calendar/v3/")) throw new Error("Unsupported Google API path");
  await audit("Google: " + options.label, "Request started.");
  try {
    const token = await googleAccess(owner, options.travelerId);
    const method = options.method ?? "GET";
    // Refreshing authorization happens before a mutation. Mutations are never
    // retried by the transport; their persisted action handles reconciliation.
    const response = await fetch("https://www.googleapis.com" + path, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(30000), cache: "no-store",
    });
    if (!response.ok) throw new GoogleError(response.status, response.status === 403
      ? "Google denied this operation. Enable Gmail and Calendar APIs, check consent scopes and calendar permissions."
      : response.status === 401 ? "Reconnect Google in Settings." : "Google request failed (" + response.status + ").");
    const result = response.status === 204 ? {} : await response.json();
    await audit("Google: " + options.label + " completed");
    return result as T;
  } catch (error) {
    const safe = error instanceof HttpError ? error : new GoogleError(502, "Google did not complete the request. Its saved action will be reconciled before any retry.");
    await audit("Google call failed", safe.message);
    throw safe;
  }
}
