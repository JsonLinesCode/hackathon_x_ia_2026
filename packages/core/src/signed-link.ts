import { SignedLinkPayloadSchema, type SignedLinkPayload } from "@repo/types";

const encoder = new TextEncoder();
const maxAge = 7 * 24 * 60 * 60;
function encode(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid signed link");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Non-canonical signed link");
  return bytes;
}
async function key(secret: string) {
  if (secret.length < 32) throw new Error("APP_SECRET must contain at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signLink(payload: SignedLinkPayload, secret: string, now = new Date()) {
  const parsed = SignedLinkPayloadSchema.parse(payload);
  const seconds = Math.floor(now.getTime() / 1000);
  if (!Number.isFinite(seconds) || parsed.exp <= seconds || parsed.exp > seconds + maxAge) {
    throw new Error("Signed links must expire within seven days");
  }
  const body = encode(encoder.encode(JSON.stringify(parsed)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return body + "." + encode(new Uint8Array(signature));
}
export async function verifyLink(token: string, purpose: SignedLinkPayload["purpose"], secret: string, now = new Date()) {
  try {
    if (token.length > 2048) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error();
    const [body, signature] = parts;
    if (!await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(body))) throw new Error();
    const payload = SignedLinkPayloadSchema.parse(JSON.parse(new TextDecoder().decode(decode(body))));
    const seconds = Math.floor(now.getTime() / 1000);
    if (!Number.isFinite(seconds) || payload.purpose !== purpose || payload.exp <= seconds || payload.exp > seconds + maxAge) throw new Error();
    return payload;
  } catch {
    throw new Error("This link is invalid or expired.");
  }
}
