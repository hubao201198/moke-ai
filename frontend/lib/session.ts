export const sessionCookieName = "maoke_session";

export function accessProtectionConfigured() {
  return Boolean(process.env.APP_ACCESS_PASSWORD && process.env.APP_SESSION_SECRET);
}

export async function verifySessionToken(token: string | undefined) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!token || !secret) return false;
  const [message, signature, extra] = token.split(".");
  if (!message || !signature || extra) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  if (mismatch !== 0) return false;
  try {
    const raw = atob(message.replaceAll("-", "+").replaceAll("_", "/"));
    const [issuedAt, nonce] = raw.split(":", 2);
    const issued = Number(issuedAt);
    const now = Math.floor(Date.now() / 1000);
    return Boolean(nonce) && Number.isFinite(issued) && issued <= now + 60 && issued > now - 7 * 24 * 60 * 60;
  } catch {
    return false;
  }
}
