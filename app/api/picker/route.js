// app/api/picker/route.js - sector -> stock -> volume -> breakout -> news ranking of the stock pool (cached 60 s). Read-only, paper research.
import { NextResponse } from "next/server";
import { runPicker } from "@/lib/picker";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await runPicker()); } catch (e) { return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 140) }); }
}
