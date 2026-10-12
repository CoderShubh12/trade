// lib/session.js
// Signed login cookie. The cookie holds { username, role, exp } plus an
// HMAC-SHA256 signature made with APP_SESSION_SECRET (server only), so nobody
// can forge or edit it. Uses only Web Crypto, so it runs in middleware too.

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64Url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64Url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const SESSION_COOKIE = "terminal_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 12; // 12 hours: one trading day

export const isSecretOk = (secret) => typeof secret === "string" && secret.length >= 32;

export async function createSessionToken(payload, secret) {
  const body = toB64Url(
    enc.encode(JSON.stringify({ ...payload, exp: Date.now() + SESSION_MAX_AGE_S * 1000 })),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${toB64Url(sig)}`;
}

// Returns the payload if the cookie is genuine and not expired, otherwise null.
export async function verifySessionToken(token, secret) {
  if (!token || !isSecretOk(secret)) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64Url(parts[1]),
      enc.encode(parts[0]),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64Url(parts[0])));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
