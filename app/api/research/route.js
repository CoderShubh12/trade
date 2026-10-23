// app/api/research/route.js - session research report from REAL live quotes only (Angel quote API, via /api/breakouts).
// No news / VIX / GIFT Nifty / sector data here: those are reported as UNAVAILABLE rather than invented.
// SL/targets use a quote-only proxy (fraction of today's range), not ATR; score is a heuristic, NOT a probability or accuracy.
import { NextResponse } from "next/server";
import { GET as breakoutsGET } from "../breakouts/route.js";
import { roundTripCost, positionSize } from "@/lib/costs";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const u = new URL(req.url).searchParams;
  const capital = Math.max(10000, Number(u.get("capital")) || 100000);
  const riskPct = Math.min(2, Math.max(0.1, Number(u.get("riskPct")) || 0.5));
  const leverage = Math.min(5, Math.max(1, Number(u.get("leverage")) || 1));
  const res = await breakoutsGET();
  const d = await res.json();
  if (!d.success) return NextResponse.json({ success: false, error: d.error || "quotes unavailable" }, { status: 502 });
  const at = new Date().toISOString();
  const nifty = d.indices?.find((x) => x.symbol === "NIFTY 50"), bank = d.indices?.find((x) => x.symbol === "BANK NIFTY");
  const avg = [nifty?.chgPct, bank?.chgPct].filter((x) => typeof x === "number");
  const mkt = avg.length ? avg.reduce((a, b) => a + b, 0) / avg.length : null;
  const trend = mkt == null ? "UNKNOWN" : mkt > 0.25 ? "BULLISH" : mkt < -0.25 ? "BEARISH" : "SIDEWAYS";
  const cands = [];
  for (const [side, list] of [["BUY", d.top20], ["SELL", d.downTop20]]) {
    for (const x of list || []) {
      if (x.hits < 4) continue;
      const hi = x.ltp / (1 - x.offDayHighPct / 100), lo = x.low > 0 ? x.low : x.ltp;
      const rg = Math.max(hi - lo, x.ltp * 0.004);
      const dist = Math.max(rg * 0.35, x.ltp * 0.003); // proxy risk distance
      const entry = x.ltp, sl = side === "BUY" ? entry - dist : entry + dist;
      const t1 = side === "BUY" ? entry + dist : entry - dist, t2 = side === "BUY" ? entry + 2 * dist : entry - 2 * dist;
      const qty = positionSize(capital, riskPct, entry, sl, leverage);
      if (qty < 1) continue;
      const cost = roundTripCost(entry, qty, side), riskAmt = dist * qty;
      const netR1 = (dist * qty - cost) / riskAmt, netR2 = (2 * dist * qty - cost) / riskAmt;
      const align = trend === "UNKNOWN" || trend === "SIDEWAYS" ? 0.4 : (trend === "BULLISH") === (side === "BUY") ? 1 : 0;
      const struct = side === "BUY" ? (x.rangePos ?? 0) : 1 - (x.rangePos ?? 1);
      const liq = Math.min(1, (x.vol || 0) * x.ltp / 5e8); // traded value so far vs Rs 50 cr
      const rr = Math.max(0, Math.min(1, netR1 / 0.9));
      const score = Math.round(25 * align + 30 * (x.hits / 6) + 15 * struct + 15 * rr + 15 * liq);
      cands.push({ symbol: x.symbol, token: x.token, side, ltp: x.ltp, chgPct: +x.chgPct.toFixed(2), hits: x.hits, met: x.met, entryTrigger: side === "BUY" ? `buy above ${(hi * 1.0005).toFixed(2)} (day high) on a closing 5m bar` : `sell below ${(lo * 0.9995).toFixed(2)} (day low) on a closing 5m bar`, entry: +entry.toFixed(2), stopLoss: +sl.toFixed(2), target1: +t1.toFixed(2), target2: +t2.toFixed(2), qty, riskAmount: +riskAmt.toFixed(0), costRs: cost, netR_T1: +netR1.toFixed(2), netR_T2: +netR2.toFixed(2), tradedValueCr: +((x.vol || 0) * x.ltp / 1e7).toFixed(1), score, invalidation: side === "BUY" ? `5m close back below ${sl.toFixed(2)}, or Nifty turns down` : `5m close back above ${sl.toFixed(2)}, or Nifty turns up` });
    }
  }
  const ranked = cands.filter((c) => c.score >= 60 && c.tradedValueCr >= 5).sort((a, b) => b.score - a.score).slice(0, 5);
  const verdict = trend === "SIDEWAYS" && ranked.length < 2 ? "NO TRADE: market sideways and no strong setups" : ranked.length === 0 ? "NO TRADE: no candidate scores >= 60" : `${ranked.length} candidate(s)`;
  return NextResponse.json({ success: true, dataAt: at, dataQuality: "Angel quote API, near real-time (polled, not streamed)", market: { trend, avgChgPct: mkt == null ? null : +mkt.toFixed(2), nifty: nifty ? { ltp: nifty.ltp, chgPct: +nifty.chgPct.toFixed(2) } : null, bankNifty: bank ? { ltp: bank.ltp, chgPct: +bank.chgPct.toFixed(2) } : null },
    unavailable: ["GIFT Nifty", "India VIX", "global cues", "economic calendar", "sector strength", "company news / earnings / bulk-block deals", "same-time-of-day relative volume", "ATR (quote-only proxy used for stops)"],
    capital, riskPct, leverage, verdict, ranked,
    caveats: "Heuristic score, not a probability. Out-of-sample tests of standard indicator strategies showed no tradable edge. Paper trade only." });
}
