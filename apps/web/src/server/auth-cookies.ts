import "server-only";
import { createChunks, stringFromBase64URL, stringToBase64URL, type CookieOptions } from "@supabase/ssr";

type CookieChange = { name: string; value: string; options: CookieOptions };

// Supabase's OAuth session includes provider tokens. Keep only its own session
// in cookies; the Google refresh token goes exclusively into google_credentials.
export function sanitizeAuthCookies(changes: CookieChange[]): CookieChange[] {
  const result = new Map(changes.map((cookie) => [cookie.name, cookie]));
  const bases = new Set(changes.filter((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name))
    .map((cookie) => cookie.name.replace(/\.\d+$/, "")));
  for (const base of bases) {
    const chunks = changes.filter((cookie) => (cookie.name === base || cookie.name.startsWith(base + ".")) && cookie.value)
      .sort((a, b) => Number(a.name.slice(base.length + 1) || 0) - Number(b.name.slice(base.length + 1) || 0));
    if (!chunks.length) continue;
    const value = chunks.map((cookie) => cookie.value).join("");
    const session = JSON.parse(value.startsWith("base64-") ? stringFromBase64URL(value.slice(7)) : value);
    if (!session || typeof session !== "object") throw new Error("Invalid auth session");
    delete session.provider_token;
    delete session.provider_refresh_token;
    const safe = "base64-" + stringToBase64URL(JSON.stringify(session));
    for (const chunk of chunks) result.set(chunk.name, { ...chunk, value: "", options: { ...chunk.options, maxAge: 0 } });
    for (const chunk of createChunks(base, safe)) result.set(chunk.name, { ...chunk, options: chunks[0].options });
  }
  return [...result.values()];
}
