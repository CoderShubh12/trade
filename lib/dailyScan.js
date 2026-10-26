// lib/dailyScan.js - pre-market DAILY scan (swing watchlist) for the stock pool, from daily closes (Yahoo, unofficial).
// Also dip_in_uptrend (added 26 Oct, forward-test only). Setups kept after our 8-year NSE test (analysis/daily_setups_test.py): bull_flag and reclaim_ma20 (5-day net positive in both halves, small, survivorship-biased).
// Dropped: oversold / oversold_bounce (negative net) and breakout_20d (negative in the second half). A hit is a list entry that matched a rule, not a buy signal.
// Each day's hits are logged so a FORWARD paper test builds up (what the close did 1 and 5 sessions later, cost 0.1%).
import fs from "fs";
import path from "path";
import { STOCK_POOL } from "@/lib/stockPool";
import { getYahooDaily } from "@/lib/yahooCandles";

const LOG = path.join(process.cwd(), "data", "daily-scan-log.json"), IST = 5.5 * 3600e3, COST = 0.001;
const g = globalThis; g.__ds = g.__ds || { at: 0, busy: null, data: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readLog = () => { try { return JSON.parse(fs.readFileSync(LOG, "utf8")); } catch { return { entries: [] }; } };

function setups(c) {
  const n = c.length; if (n < 30) return [];
  const ma200 = n >= 200 ? c.slice(n - 200).reduce((a, x) => a + x, 0) / 200 : null;
  const ma = (i) => c.slice(i - 19, i + 1).reduce((a, x) => a + x, 0) / 20, out = [], i = n - 1;
  const rng5 = c.slice(i - 4, i + 1), flatBox = (Math.max(...rng5) - Math.min(...rng5)) / Math.min(...rng5) < 0.05, run = c[i - 5] / c[i - 15] - 1 > 0.10;
  if (run && flatBox) out.push({ setup: "bull_flag", why: `up ${(run ? (c[i - 5] / c[i - 15] - 1) * 100 : 0).toFixed(0)}% in 10 sessions, last 5 closes inside a 5% box` });
  if (c[i - 1] < ma(i - 1) && c[i] > ma(i)) out.push({ setup: "reclaim_ma20", why: "closed back above its 20-day average" });
  // 3-day drop >5% while still above the 200-day average: positive in both halves of our 8y test, but mostly market-wide dips and survivorship-biased (analysis/swing_test.py)
  if (ma200 && c[i] > ma200 && c[i] / c[i - 3] - 1 < -0.05) out.push({ setup: "dip_in_uptrend", why: `fell ${((1 - c[i] / c[i - 3]) * 100).toFixed(1)}% in 3 sessions, still above its 200-day average` });
  return out;
}
export async function runDailyScan(force = false) {
  const G = g.__ds; if (!force && G.data && Date.now() - G.at < 30 * 60000) return G.data; if (G.busy) return G.busy;
  G.busy = (async () => {
    const now = new Date(Date.now() + IST), today = now.toISOString().slice(0, 10), hhmm = now.getUTCHours() * 100 + now.getUTCMinutes(), hits = [], bars = {};
    let ok = 0, bad = 0, lastDate = "";
    for (const s of STOCK_POOL.filter((x) => x.baseBand !== "INDEX")) {
      try {
        let d = await getYahooDaily(s.token); if (d.length && d[d.length - 1].date === today && hhmm < 1545) d = d.slice(0, -1); // drop today's unfinished bar
        ok++; bars[s.symbol] = d; if (d.length) lastDate = d[d.length - 1].date;
        const c = d.map((x) => x.close), last = d[d.length - 1]; if (!last) continue;
        for (const h of setups(c)) hits.push({ symbol: s.symbol, token: s.token, ...h, close: +last.close.toFixed(2), date: last.date, traded: Math.round((last.close * last.volume) / 1e7) });
      } catch { bad++; }
      await sleep(200);
    }
    hits.sort((a, b) => b.traded - a.traded);
    // log (once per data date) and evaluate the forward record
    const log = readLog(); if (lastDate && hits.length && !log.entries.some((e) => e.date === lastDate)) { log.entries.push(...hits.map((h) => ({ date: lastDate, symbol: h.symbol, setup: h.setup, close: h.close }))); try { fs.writeFileSync(LOG, JSON.stringify(log)); } catch {} }
    const fwd = { reclaim_ma20: { r1: [], r5: [] }, bull_flag: { r1: [], r5: [] }, dip_in_uptrend: { r1: [], r5: [] } };
    for (const e of log.entries) { const d = bars[e.symbol]; if (!d) continue; const i = d.findIndex((x) => x.date === e.date); if (i < 0) continue; if (d[i + 1]) fwd[e.setup]?.r1.push(d[i + 1].close / e.close - 1 - COST); if (d[i + 5]) fwd[e.setup]?.r5.push(d[i + 5].close / e.close - 1 - COST); }
    const avg = (a) => (a.length ? +(100 * a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
    const forward = Object.fromEntries(Object.entries(fwd).map(([k, v]) => [k, { n1: v.r1.length, avg1Pct: avg(v.r1), n5: v.r5.length, avg5Pct: avg(v.r5) }]));
    G.data = { success: true, asOf: lastDate, scanned: ok, failed: bad, hits, forward, loggedDays: new Set(log.entries.map((e) => e.date)).size,
      note: "Matched a rule on daily closes; not a buy list. Backtest (8y NSE, 44 stocks) showed a small 5-day positive net for these two setups, but it has survivorship bias and no proof out of sample. Forward record below starts from today's logs." };
    G.at = Date.now(); return G.data;
  })().finally(() => { G.busy = null; });
  return G.busy;
}
