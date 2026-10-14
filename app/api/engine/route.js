// app/api/engine/route.js
// GET  /api/engine            -> starts the server engine (if SERVER_ENGINE=1) and returns its status
// POST /api/engine {pause:true|false} -> pause / resume new calls (open calls are still monitored)
import { NextResponse } from "next/server";
import { startEngine, pauseEngine, engineStatus } from "../../../lib/serverEngine.js";

export const dynamic = "force-dynamic";

export async function GET() {
  startEngine();
  return NextResponse.json({ success: true, ...engineStatus() });
}

export async function POST(request) {
  let b = {}; try { b = await request.json(); } catch {}
  if (typeof b.pause === "boolean") pauseEngine(b.pause);
  return NextResponse.json({ success: true, ...engineStatus() });
}
