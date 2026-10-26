// app/api/time-machine/route.js - GET ?token&side&entry&stop&target&entryTime&until&seed -> 10,000 bootstrap replays + history (paper research, no orders).
import { NextResponse } from "next/server";
import { getYahooHistory60 } from "@/lib/yahooCandles";
import { timeMachine } from "@/lib/timeMachine";

export const dynamic = "force-dynamic";
export async function GET(request) {
  const u = new URL(request.url).searchParams, num = (k) => Number(u.get(k)), side = (u.get("side") || "").toUpperCase();
  const token = u.get("token") || "", clock = (k, d) => (/^\d{2}:\d{2}$/.test(u.get(k) || "") ? u.get(k) : d);
  if (!/^\d{1,10}$/.test(token) || !["BUY", "SELL"].includes(side) || ![num("entry"), num("stop"), num("target")].every((x) => x > 0))
    return NextResponse.json({ success: false, error: "Need token, side (BUY/SELL), entry, stop, target." }, { status: 400 });
  try {
    const bars = await getYahooHistory60(token);
    const r = timeMachine(bars, { side, entry: num("entry"), stop: num("stop"), target: num("target"), entryTime: clock("entryTime", "10:15"), until: clock("until", "15:15") }, { seed: Number(u.get("seed")) || 19 });
    return NextResponse.json({ success: true, ...r });
  } catch (e) { return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 160) }, { status: 200 }); }
}
