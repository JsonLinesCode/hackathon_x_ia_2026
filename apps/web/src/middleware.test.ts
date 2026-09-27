import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ getUser: vi.fn(), client: vi.fn() }));
vi.mock("@supabase/ssr", async (original) => ({ ...await original<typeof import("@supabase/ssr")>(), createServerClient: auth.client }));
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
  auth.client.mockReturnValue({ auth: { getUser: auth.getUser } });
});
describe("auth middleware", () => {
  it.each(["/api/travelers", "/api/google/traveler/callback", "/api/events", "/login", "/auth/callback", "/r/signed-token"])("does not redirect the public/self-authenticated route %s", async (path) => {
    const response = await middleware(new NextRequest("http://localhost:3000" + path));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(auth.client).not.toHaveBeenCalled();
  });
  it("protects pages using a verified user rather than a client session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await middleware(new NextRequest("http://localhost:3000/travelers"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    expect(auth.getUser).toHaveBeenCalled();
  });
  it("allows authenticated pages and prevents shared caching", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "manager" } }, error: null });
    const response = await middleware(new NextRequest("http://localhost:3000/policies"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
});
