// app/api/engine/route.js
// GET  /api/engine            -> starts the server engine (if SERVER_ENGINE=1) and returns its status
// POST /api/engine {pause:true|false} -> pause / resume new calls (open calls are still monitored)
import { NextResponse } from "next/server";
import { requestUser, ownerName } from "../../../lib/userScope.js";
import { startEngine, pauseEngine, engineStatus } from "../../../lib/serverEngine.js";

export const dynamic = "force-dynamic";

// The automated engine trades the OWNER's paper journal only. Other users see it as "off" and neither read nor control it.
const isOwner = (request) => { const u = requestUser(request); return !u || u === ownerName(); };

export async function GET(request) {
  if (!isOwner(request)) return NextResponse.json({ success: true, enabled: false, running: false, ownerOnly: true, open: [], log: [] });
  startEngine();
  return NextResponse.json({ success: true, ...engineStatus() });
}

export async function POST(request) {
  if (!isOwner(request)) return NextResponse.json({ success: false, error: "Owner only" }, { status: 403 });
  let b = {}; try { b = await request.json(); } catch {}
  if (typeof b.pause === "boolean") pauseEngine(b.pause);
  return NextResponse.json({ success: true, ...engineStatus() });
}
