import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ userClient: vi.fn(), serviceClient: vi.fn() }));
vi.mock("./db", () => ({ createUserClient: state.userClient, createServiceClient: state.serviceClient }));
import { GET } from "@/app/auth/callback/route";
import { POST } from "@/app/auth/signin/route";

const userId = "cc02a830-3634-4c56-99f5-6614b20246c7";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
});
function setup(refreshToken: string | null) {
  const exchangeCodeForSession = vi.fn().mockResolvedValue({
    error: null, data: { session: { provider_refresh_token: refreshToken } },
  });
  const getUser = vi.fn().mockResolvedValue({
    error: null, data: { user: { id: userId, email: "manager@example.com", user_metadata: { full_name: "Manager" } } },
  });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ upsert });
  state.userClient.mockResolvedValue({ auth: { exchangeCodeForSession, getUser } });
  state.serviceClient.mockReturnValue({ from });
  return { exchangeCodeForSession, getUser, upsert, from };
}
describe("Google OAuth callback", () => {
  it("stores the provider refresh token in the service-only credential table and preserves existing policy", async () => {
    const { upsert, from } = setup("test-google-refresh-token");
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=test-code"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(from).toHaveBeenCalledWith("google_credentials");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: userId, refresh_token: "test-google-refresh-token", invalidated_at: null }), { onConflict: "user_id" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: userId }), { onConflict: "owner_id", ignoreDuplicates: true });
    expect(await response.text()).not.toContain("test-google-refresh-token");
  });
  it("shows reconnect instructions when Google returns no refresh token", async () => {
    const { from } = setup(null);
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=test-code"));
    expect(response.headers.get("location")).toContain("/profile?connection=missing_refresh_token");
    expect(from).not.toHaveBeenCalledWith("google_credentials");
  });
  it("does not store credentials for an unverified user", async () => {
    const { getUser, from } = setup("test-token");
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=test-code"));
    expect(response.headers.get("location")).toContain("error=callback");
    expect(from).not.toHaveBeenCalled();
  });
  it("handles consent denial and missing authorization codes", async () => {
    setup(null);
    const response = await GET(new Request("http://localhost:3000/auth/callback?error=access_denied"));
    expect(response.headers.get("location")).toContain("error=consent");
    expect(state.userClient).not.toHaveBeenCalled();
  });
  it("requests offline access and consent using APP_URL, without a caller-controlled redirect", async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: { url: "https://accounts.google.com/test-oauth" }, error: null });
    state.userClient.mockResolvedValue({ auth: { signInWithOAuth } });
    const response = await POST(new Request("http://localhost:3000/auth/signin", { method: "POST" }));
    expect(response.status).toBe(303);
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        redirectTo: "http://localhost:3000/auth/callback",
        queryParams: { access_type: "offline", prompt: "consent" },
        scopes: expect.stringContaining("https://www.googleapis.com/auth/gmail.readonly"),
      }),
    }));
  });
});
