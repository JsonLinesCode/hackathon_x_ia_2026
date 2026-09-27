import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { getEnv } from "@/server/env";
import { checkOrigin, handleApi, HttpError } from "@/server/http";

export async function POST(request: Request) {
  return handleApi(async () => {
    const { db } = await requireUser();
    checkOrigin(request);
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error) throw new HttpError(502, "Sign out failed. Please try again.");
    return NextResponse.redirect(new URL("/login", getEnv(["APP_URL"]).APP_URL), 303);
  });
}
