// middleware.js
import { NextResponse } from "next/server";

export function middleware(request) {
  const sessionCookie = request.cookies.get("terminal_session");
  const { pathname } = request.nextUrl;

  // Allow access to login page and api routes
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) {
    if (sessionCookie) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // Protect dashboard and other private routes
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

// Specify which routes to protect
export const config = {
  matcher: ["/", "/tips/:path*"],
};
