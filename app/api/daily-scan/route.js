// app/api/daily-scan/route.js - pre-market daily scan (bull_flag, reclaim_ma20) over the stock pool; cached 30 min; logs hits for a forward test.
import { NextResponse } from "next/server";
import { runDailyScan } from "@/lib/dailyScan";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await runDailyScan()); } catch (e) { return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 120) }); }
}
