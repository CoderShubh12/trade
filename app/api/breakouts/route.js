// app/api/breakouts/route.js - read-only ranking of "near-high / breakout" stocks from ONE Angel quote call (mode FULL).
// Uses real quote fields only (ltp, day high/low/open, prev close, 52-week high). No candles, so it does not touch the candle quota.
import { NextResponse } from "next/server";
import axios from "axios";
import { STOCK_POOL } from "@/lib/stockPool";
import { getAngelSession } from "@/lib/angelAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await getAngelSession();
    const pool = STOCK_POOL.filter((x) => x.baseBand !== "INDEX");
    const rows = [];
    for (let i = 0; i < pool.length; i += 50) { // FULL quote accepts up to 50 tokens per call
      const res = await axios.post(
        "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",
        { mode: "FULL", exchangeTokens: { NSE: pool.slice(i, i + 50).map((x) => String(x.token)) } },
        { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": s.apiKey }, timeout: 6000 },
      );
      rows.push(...(res.data?.data?.fetched || []));
    }
    const sym = new Map(pool.map((x) => [String(x.token), x.symbol]));
    const out = rows.map((r) => {
      const ltp = Number(r.ltp), hi = Number(r.high), lo = Number(r.low), pc = Number(r.close), w52 = Number(r["52WeekHigh"]);
      const chg = pc > 0 ? ((ltp - pc) / pc) * 100 : null;
      const offDayHigh = hi > 0 ? ((hi - ltp) / hi) * 100 : null; // 0 = trading at the day high
      const to52 = w52 > 0 ? ((w52 - ltp) / w52) * 100 : null;
      const range = hi > lo ? (ltp - lo) / (hi - lo) : null; // 1 = at day high
      return { symbol: sym.get(String(r.symbolToken)) || r.tradingSymbol, token: String(r.symbolToken), ltp, chgPct: chg, offDayHighPct: offDayHigh, to52wHighPct: to52, rangePos: range, vol: Number(r.tradeVolume) || 0, open: Number(r.open), prevClose: pc };
    }).filter((x) => x.ltp > 0 && x.chgPct != null && x.offDayHighPct != null);
    // Chartink-style counter: each classic breakout condition met = 1 hit. Rank by hits, then by % change.
    const CONDS = [
      ["Up >0.5% on day", (x) => x.chgPct > 0.5],
      ["Within 0.25% of day high", (x) => x.offDayHighPct <= 0.25],
      ["Upper 20% of day range", (x) => x.rangePos != null && x.rangePos >= 0.8],
      ["Above today's open", (x) => x.open > 0 && x.ltp > x.open],
      ["Gap-up open", (x) => x.prevClose > 0 && x.open > x.prevClose * 1.002],
      ["Within 5% of 52-wk high", (x) => x.to52wHighPct != null && x.to52wHighPct <= 5],
    ];
    const scored = out.map((x) => { const met = CONDS.filter(([, f]) => f(x)).map(([n]) => n); return { ...x, hits: met.length, met }; });
    const top20 = scored.filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || b.chgPct - a.chgPct).slice(0, 20);
    const picks = scored.filter((x) => x.hits >= 5).sort((a, b) => b.hits - a.hits || b.chgPct - a.chgPct);
    const nearest = [...out].sort((a, b) => a.offDayHighPct - b.offDayHighPct).slice(0, 5); // closest to the day high, for context when picks is empty
    return NextResponse.json({ success: true, scanned: out.length, conditions: CONDS.map(([n]) => n), top20, picks, nearest, note: "Quote-based screen only. A pick is a candidate for the engine to evaluate, not a call." });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.response?.data?.message || e.message }, { status: 500 });
  }
}
