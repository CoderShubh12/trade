// app/api/history-fetch/route.js - OWNER only. Downloads long history (default 60m bars, 2y) from Yahoo (unofficial) for the 44 research stocks
// into data/movers/60m/<SYMBOL>_60m.json (IST date/clock). Runs in the background; GET returns progress. Research data only.
import { NextResponse } from "next/server";
import axios from "axios";
import fs from "fs";
import path from "path";
import { requestUser, ownerName } from "@/lib/userScope";

export const dynamic = "force-dynamic";
const g = globalThis;
g.__hist = g.__hist || { running: false, done: 0, total: 0, errors: [], interval: "" };
const IST = 5.5 * 3600 * 1000;

async function run(interval, range) {
  const H = g.__hist; H.running = true; H.done = 0; H.errors = []; H.interval = interval;
  const dir5 = path.join(process.cwd(), "data", "movers", "5m"), out = path.join(process.cwd(), "data", "movers", interval.replace("m", "m"));
  fs.mkdirSync(out, { recursive: true });
  const syms = fs.readdirSync(dir5).filter((f) => f.endsWith("_5m.json")).map((f) => f.replace("_5m.json", ""));
  const idx = ["NIFTY", "BANKNIFTY"]; H.total = syms.length + 2;
  for (const s of [...syms, ...idx]) {
    try {
      const y = s === "NIFTY" ? "^NSEI" : s === "BANKNIFTY" ? "^NSEBANK" : encodeURIComponent(s) + ".NS";
      const r = (await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${y}`, { params: { interval, range }, timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } })).data?.chart?.result?.[0];
      const q = r.indicators.quote[0], candles = [];
      r.timestamp.forEach((ts, i) => { if (q.close[i] == null || q.open[i] == null) return; const iso = new Date(ts * 1000 + IST).toISOString(); candles.push({ date: iso.slice(0, 10), clock: iso.slice(11, 16), open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 }); });
      fs.writeFileSync(path.join(out, `${s}_${interval}.json`), JSON.stringify({ meta: { symbol: s, interval, range, source: "yahoo-unofficial" }, candles }));
    } catch (e) { H.errors.push(`${s}: ${String(e.message).slice(0, 60)}`); }
    H.done++; await new Promise((r) => setTimeout(r, 400));
  }
  H.running = false;
}

export async function GET(request) {
  const u = requestUser(request);
  if (u && u !== ownerName()) return NextResponse.json({ success: false, error: "Owner only" }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  if (sp.get("start") && !g.__hist.running) { const iv = /^(60m|1d)$/.test(sp.get("interval") || "") ? sp.get("interval") : "60m"; run(iv, sp.get("range") || (iv === "1d" ? "5y" : "2y")); }
  return NextResponse.json({ success: true, ...g.__hist });
}
