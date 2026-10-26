// app/api/india-gap/route.js - starts the NSE-vs-BSE paper gap scanner (if needed) and returns its stats. Owner only; no orders.
import { NextResponse } from "next/server";
import { ensureIndiaGap, indiaGapStatus } from "@/lib/indiaGap";
import { requestUser, ownerName } from "@/lib/userScope";

export const dynamic = "force-dynamic";
export async function GET(request) {
  const u = requestUser(request);
  if (u && u !== ownerName()) return NextResponse.json({ success: false, error: "Owner only" }, { status: 403 });
  ensureIndiaGap();
  return NextResponse.json({ success: true, ...indiaGapStatus() });
}
