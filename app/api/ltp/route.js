// app/api/ltp/route.js  - latest streamed prices (no Angel REST call, safe to poll every second)
import { NextResponse } from "next/server";
import { getTicks } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("tokens") || "";
  const tokens = raw.split(",").map((s) => s.trim()).filter((s) => /^\d{1,12}$/.test(s)).slice(0, 5);
  if (!tokens.length) return NextResponse.json({ success: false, error: "tokens required" }, { status: 400 });
  return NextResponse.json({ success: true, ...(await getTicks(tokens)) });
}
