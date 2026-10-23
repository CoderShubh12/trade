// app/api/research-bot/route.js - owner-only. GET starts the paper research bot timer (if not running) and returns today's status.
import { NextResponse } from "next/server";
import { ensureRunning, status } from "@/lib/researchBot";
import { requestUser, ownerName } from "@/lib/userScope";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const u = requestUser(request);
  if (u && u !== ownerName()) return NextResponse.json({ success: false, error: "Owner only" }, { status: 403 });
  ensureRunning();
  return NextResponse.json({ success: true, ...status(), paperOnly: true });
}
