// app/api/auth/login/route.js
// Login. The user name and password come from .env.local (never from code):
//   APP_LOGIN_USER=...
//   APP_LOGIN_PASSWORD=...
//   APP_SESSION_SECRET=...   (at least 32 random characters)
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  createSessionToken,
  isSecretOk,
} from "@/lib/session";
import { loadUsers } from "@/lib/userScope";

// Compare without leaking how many characters matched
const sha = (s) => createHash("sha256").update(String(s)).digest();
const same = (a, b) => timingSafeEqual(sha(a), sha(b));

// Simple brute-force brake: 5 wrong tries per 15 minutes per address
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

function tooManyTries(ip) {
  const now = Date.now();
  const rec = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, rec);
  return rec.length >= MAX_FAILS;
}

export async function POST(request) {
  const users = loadUsers(); // owner + up to 4 more (APP_USERS="name:password;name2:password2")
  const secret = process.env.APP_SESSION_SECRET;

  // Fail closed: if the server is not configured, nobody gets in.
  if (!users.length || !isSecretOk(secret)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Login is not configured. Add APP_LOGIN_USER, APP_LOGIN_PASSWORD and APP_SESSION_SECRET (32+ characters) to .env.local and restart.",
      },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (tooManyTries(ip)) {
    return NextResponse.json(
      { success: false, error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
  }

  // Check every account every time so timing does not reveal which name or password was wrong
  let found = null;
  for (const u of users) {
    const userOk = same(body?.username ?? "", u.name);
    const passOk = same(body?.password ?? "", u.pass);
    if (userOk && passOk && !found) found = u;
  }
  if (!found) {
    attempts.get(ip).push(Date.now());
    return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
  }

  attempts.delete(ip);
  const token = await createSessionToken({ username: found.name, role: found.role === "owner" ? "admin" : "user" }, secret);
  const response = NextResponse.json({ success: true, role: found.role === "owner" ? "admin" : "user" });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return response;
}
