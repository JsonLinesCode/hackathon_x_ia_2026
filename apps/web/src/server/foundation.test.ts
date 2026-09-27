import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createChunks, stringToBase64URL, stringFromBase64URL } from "@supabase/ssr";
import { getEnv } from "./env";
import { sanitizeAuthCookies } from "./auth-cookies";

describe("lazy, phase-scoped environment validation", () => {
  it("does not require future integration keys", () => {
    expect(getEnv(["APP_URL"], { APP_URL: "http://localhost:3000/" })).toEqual({ APP_URL: "http://localhost:3000" });
    expect(getEnv(["JINKO_API_KEY_HEADER"], {})).toEqual({ JINKO_API_KEY_HEADER: "Authorization" });
  });
  it("names missing variables without echoing secret values", () => {
    expect(() => getEnv(["APP_SECRET"], { APP_SECRET: "do-not-expose" })).toThrow(/APP_SECRET/);
    try { getEnv(["APP_SECRET"], { APP_SECRET: "do-not-expose" }); }
    catch (error) { expect(String(error)).not.toContain("do-not-expose"); }
    expect(() => getEnv(["NEXT_PUBLIC_SUPABASE_URL"], {})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => getEnv(["APP_URL"], { APP_URL: "ftp://example.com" })).toThrow(/APP_URL/);
  });
});

describe("server-only provider credentials", () => {
  it("removes Google tokens from single and chunked session cookies", () => {
    for (const large of [false, true]) {
      const session = {
        access_token: "supabase-access", refresh_token: "supabase-refresh",
        provider_token: "private-google-access", provider_refresh_token: "private-google-refresh".repeat(large ? 500 : 1),
        user: { id: "manager-id" },
      };
      const chunks = createChunks("sb-project-auth-token", "base64-" + stringToBase64URL(JSON.stringify(session)));
      const output = sanitizeAuthCookies(chunks.map((cookie) => ({ ...cookie, options: { httpOnly: true, path: "/" } })));
      const kept = output.filter((cookie) => cookie.value).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const decoded = JSON.parse(stringFromBase64URL(kept.map((cookie) => cookie.value).join("").slice(7)));
      expect(decoded).not.toHaveProperty("provider_token");
      expect(decoded).not.toHaveProperty("provider_refresh_token");
      expect(decoded.refresh_token).toBe("supabase-refresh");
      expect(kept.every((cookie) => cookie.options.httpOnly)).toBe(true);
      if (large) expect(output.some((cookie) => cookie.value === "" && cookie.options.maxAge === 0)).toBe(true);
    }
  });
  it("preserves PKCE verifier cookies and deletion instructions", () => {
    const cookies = [{ name: "sb-project-auth-token-code-verifier", value: "pkce", options: { httpOnly: true } },
      { name: "sb-project-auth-token", value: "", options: { maxAge: 0 } }];
    expect(sanitizeAuthCookies(cookies)).toEqual(cookies);
  });
  it("fails closed if the session cannot be decoded", () => {
    expect(() => sanitizeAuthCookies([{ name: "sb-project-auth-token", value: "invalid", options: {} }])).toThrow();
  });
});
