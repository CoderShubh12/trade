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
    const pool = STOCK_POOL.slice(0, 50);
    const res = await axios.post(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",
      { mode: "FULL", exchangeTokens: { NSE: pool.map((x) => String(x.token)) } },
      { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": s.apiKey }, timeout: 6000 },
    );
    const rows = res.data?.data?.fetched || [];
    const sym = new Map(pool.map((x) => [String(x.token), x.symbol]));
    const out = rows.map((r) => {
      const ltp = Number(r.ltp), hi = Number(r.high), lo = Number(r.low), pc = Number(r.close), w52 = Number(r["52WeekHigh"]);
      const chg = pc > 0 ? ((ltp - pc) / pc) * 100 : null;
      const offDayHigh = hi > 0 ? ((hi - ltp) / hi) * 100 : null; // 0 = trading at the day high
      const to52 = w52 > 0 ? ((w52 - ltp) / w52) * 100 : null;
      const range = hi > lo ? (ltp - lo) / (hi - lo) : null; // 1 = at day high
      return { symbol: sym.get(String(r.symbolToken)) || r.tradingSymbol, token: String(r.symbolToken), ltp, chgPct: chg, offDayHighPct: offDayHigh, to52wHighPct: to52, rangePos: range, vol: Number(r.tradeVolume) || 0 };
    }).filter((x) => x.ltp > 0 && x.chgPct != null && x.offDayHighPct != null);
    // breakout-style: up on the day, sitting at/near the day high, ranked by closeness to the 52-week high
    const picks = out.filter((x) => x.chgPct > 0.5 && x.offDayHighPct <= 0.25).sort((a, b) => (a.to52wHighPct ?? 99) - (b.to52wHighPct ?? 99)).slice(0, 8);
    const nearest = [...out].sort((a, b) => a.offDayHighPct - b.offDayHighPct).slice(0, 5); // closest to the day high, for context when picks is empty
    return NextResponse.json({ success: true, scanned: out.length, picks, nearest, note: "Quote-based screen only. A pick is a candidate for the engine to evaluate, not a call." });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.response?.data?.message || e.message }, { status: 500 });
  }
}
