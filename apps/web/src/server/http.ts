import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { EnvironmentError, getEnv } from "./env";
import { UnauthorizedError } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(getEnv(["APP_URL"]).APP_URL).origin) {
    throw new HttpError(403, "This request must come from Travel Manager.");
  }
}
export async function readJson(request: Request) {
  try { return await request.json(); }
  catch { throw new HttpError(400, "Send a valid JSON request body."); }
}
export function checkDatabase(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "")) {
    throw new HttpError(503, "Database setup is incomplete. Run supabase/migrations/0001_foundation.sql in Supabase.");
  }
  if (error.code === "23505") throw new HttpError(409, "A traveler with this email already exists.");
  if (error.code === "23503") throw new HttpError(409, "This traveler belongs to a trip and cannot be deleted.");
  throw new HttpError(502, "The database request failed. Please try again.");
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function handleApi(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof UnauthorizedError) return json({ error: error.message }, 401);
    if (error instanceof EnvironmentError) return json({ error: error.message }, 503);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({
      error: "Check the highlighted fields.",
      fields: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    }, 400);
    return json({ error: "The request could not be completed. Please try again." }, 500);
  }
}
