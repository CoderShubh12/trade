// app/api/breach/route.js - RESEARCH ONLY: ORB breach state for one stock + multi-stock breadth, from live tick candles (no Angel candle calls).
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getTickCandles } from "@/lib/tickCandles";
import { breachState, breadth } from "@/lib/breachBot";

export const dynamic = "force-dynamic";

function stats() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "analysis", "breach_summary.json"), "utf8")); } catch { return null; }
}

export async function GET(req) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  const own = getTickCandles(token);
  const st = breachState(own);
  let others = [];
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "watchlist.json"), "utf8")).slice(0, 6).map((w) => String(w.token));
    others = [...wl, "99926000"].filter((t) => t !== String(token)).map((t) => getTickCandles(t));
  } catch {}
  const br = breadth(others);
  const s = stats();
  const t = s?.test;
  let lean = null;
  if (st?.now && st.now !== "INSIDE" && br) {
    const agree = st.now === "UP" ? br.share >= 0.6 : br.share <= 0.4;
    lean = { breadthAgrees: agree };
  }
  return NextResponse.json({
    token, bars: own.length, state: st, breadth: br, lean,
    backtest: t ? { oosContinuationHitPct: t.all?.hit, oosBaselinePct: t.base?.hit, oosWithBreadthPct: t.agree?.hit, n: t.all?.n } : null,
    verdict: t && t.all?.hit < t.base?.hit ? "NO EDGE: breaches historically did not continue (out-of-sample hit below baseline). Info only." : "Info only.",
    researchOnly: true,
  });
}
