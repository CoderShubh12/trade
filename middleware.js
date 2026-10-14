// middleware.js (session check; rebuilt 2026-10-12 so it picks up the new APP_SESSION_SECRET)
// Every page and every /api route needs a genuine (signed, unexpired) login
// cookie, except the login page and /api/auth/*.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const secret = process.env.APP_SESSION_SECRET;
  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE)?.value,
    secret,
  );

  // Login page and auth API are open; a logged-in user is sent to the dashboard
  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname.startsWith("/login")) {
    return session
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Not logged in" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/tips/:path*", "/dashboard/:path*", "/login", "/api/:path*"],
};
