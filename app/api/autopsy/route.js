// app/api/autopsy/route.js
// GET /api/autopsy?limit=30&live=1
// "Reverse tracking": for every closed journal trade, replay that day's 5m candles bar by bar (lib/autopsy.js) and explain what happened.
// Candles come from the recorded history (data/movers/5m, data/history); if the day is not there, the last 5 days are fetched through the
// candle route (live=0 turns that off). Also returns the multi-stock summary from analysis/autopsy_summary.json when it exists.
// Read-only and explanation-only: nothing here places, blocks or changes a trade.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { readJournal } from "../../../lib/journalStore.js";
import { autopsyTrade } from "../../../lib/autopsy.js";
import { GET as candlesGET } from "../market-data/route.js";

export const dynamic = "force-dynamic";

const IST_MS = 330 * 60000;
const p2 = (n) => String(n).padStart(2, "0");
// Make sure every candle has date + clock (the live route may only give `time`).
function norm(list) {
  const out = [];
  for (const c of list || []) {
    if (!c || !c.time) continue;
    let { date, clock } = c;
    if (!date || !clock) { const d = new Date(c.time * 1000 + IST_MS); date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; clock = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
    out.push({ time: c.time, date, clock, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 });
  }
  return out.sort((a, b) => a.time - b.time);
}

async function readCached(sym) {
  for (const f of [`data/movers/5m/${sym}_5m.json`, `data/history/${sym}_5m.json`]) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(process.cwd(), f), "utf8"));
      if (Array.isArray(j.candles) && j.candles.length) return { candles: norm(j.candles.filter((b) => b.volume > 0)), token: j.meta?.token ? String(j.meta.token) : "" };
    } catch { /* try next */ }
  }
  return { candles: [], token: "" };
}

async function readLive(token) {
  try {
    const r = await candlesGET(new Request(`http://local/api/market-data?token=${encodeURIComponent(token)}&tf=5`));
    const j = await r.json();
    return j && j.success && Array.isArray(j.data) ? norm(j.data.filter((b) => b.volume > 0)) : [];
  } catch { return []; }
}

function dayChart(candles, rep) {
  const day = candles.filter((c) => c.date === rep.date);
  let pv = 0, vv = 0;
  const vwap = day.map((c) => { pv += ((c.high + c.low + c.close) / 3) * c.volume; vv += c.volume; return vv > 0 ? +(pv / vv).toFixed(2) : null; });
  const clocks = day.map((c) => c.clock);
  const ei = Math.max(0, clocks.findIndex((x) => x >= rep.entryClock));
  let xi = clocks.length - 1;
  for (let i = 0; i < clocks.length; i++) if (clocks[i] <= rep.exitClock) xi = i;
  return { bars: day.map((c) => [c.clock, c.open, c.high, c.low, c.close]), vwap, entryIdx: ei, exitIdx: Math.max(ei, xi) };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 30));
  const live = searchParams.get("live") !== "0";
  try {
    const journal = (await readJournal()).filter((t) => t && t.exitPrice != null && t.entry > 0).slice(-limit).reverse();
    const store = {};                 // symbol -> { candles, token, liveTried }
    let liveCalls = 0;
    const trades = [], skipped = [];
    for (const t of journal) {
      const s = (store[t.symbol] = store[t.symbol] || { ...(await readCached(t.symbol)), liveTried: false });
      let has = s.candles.some((c) => c.date === t.dateStr);
      let source = "recorded history";
      if (!has && live && !s.liveTried && liveCalls < 6) {
        const token = String(t.token || s.token || "");
        s.liveTried = true;
        if (token) {
          liveCalls++;
          const fresh = await readLive(token);
          if (fresh.length) {
            const seen = new Set(s.candles.map((c) => c.time));
            s.candles = s.candles.concat(fresh.filter((c) => !seen.has(c.time))).sort((a, b) => a.time - b.time);
          }
        }
        has = s.candles.some((c) => c.date === t.dateStr);
        if (has) source = "live candle feed";
      }
      if (!has) { skipped.push({ id: t.id, symbol: t.symbol, date: t.dateStr, reason: "No 5m candles recorded for this day yet" }); continue; }
      const rep = autopsyTrade(t, s.candles);
      if (rep.error) { skipped.push({ id: t.id, symbol: t.symbol, date: t.dateStr, reason: rep.error }); continue; }
      trades.push({ ...rep, source, levels: { entry: t.entry, stop: t.initialSl ?? t.stopLoss, t1: t.target1, exit: t.exitPrice }, exitReason: t.reason || "", chart: dayChart(s.candles, rep) });
    }
    let aggregate = null;
    try { aggregate = JSON.parse(await fs.readFile(path.join(process.cwd(), "analysis", "autopsy_summary.json"), "utf8")); } catch { /* not generated yet */ }
    let samples = [];
    try { samples = JSON.parse(await fs.readFile(path.join(process.cwd(), "analysis", "autopsy_samples.json"), "utf8")); } catch { /* not generated yet */ }
    return NextResponse.json({ success: true, time: new Date().toISOString(), closedTrades: journal.length, trades, skipped, aggregate, samples });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e.message || e) }, { status: 500 });
  }
}
