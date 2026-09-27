import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, EnvironmentError } from "@/server/env";
import { sanitizeAuthCookies } from "@/server/auth-cookies";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // APIs authenticate themselves and must return JSON, never login redirects.
  if (path === "/api" || path.startsWith("/api/") || path === "/login"
    || path === "/auth" || path.startsWith("/auth/") || path === "/r" || path.startsWith("/r/")
    || path === "/demo" || path === "/my-trip" || path === "/assistant" || path === "/itinerary") {
    return NextResponse.next();
  }
  try {
    const env = getSupabaseEnv();
    let response = NextResponse.next({ request });
    const db = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (changes) => {
          const safe = sanitizeAuthCookies(changes);
          safe.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          safe.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) {
      const login = request.nextUrl.clone();
      login.pathname = "/login";
      login.search = "";
      const redirect = NextResponse.redirect(login);
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("error", error instanceof EnvironmentError ? "configuration" : "unavailable");
    return NextResponse.redirect(login);
  }
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)"],
};
