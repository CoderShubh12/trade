// app/api/pattern-alerts/route.js - starts the pattern watcher if needed and returns recent W/M alerts (any logged-in user; middleware guards login).
import { NextResponse } from "next/server";
import { ensurePatternWatch, patternStatus } from "@/lib/patternWatch";

export const dynamic = "force-dynamic";
export async function GET() {
  ensurePatternWatch();
  return NextResponse.json({ success: true, ...patternStatus(), note: "Pattern alerts only. Not trade advice; these rules have not passed out-of-sample tests." });
}
