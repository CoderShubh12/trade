// lib/yahooCandles.js - chart HISTORY source (unofficial Yahoo Finance chart endpoint) used while Angel's candle API is throttled.
// 5m/15m bars for ~5 sessions, ~real-time. Unofficial: it can break or be rate limited, so callers must fall back to live tick bars.
import axios from "axios";
import fs from "fs";
import path from "path";

const g = globalThis;
g.__yahooCache = g.__yahooCache || new Map();
let SCRIP = null;
function symbolFor(token) {
  const t = String(token);
  if (t === "99926000") return "^NSEI";
  if (t === "99926009") return "^NSEBANK";
  if (!SCRIP) { try { SCRIP = new Map(JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "scrip-master.json"), "utf8")).list.map((x) => [String(x.token), x])); } catch { SCRIP = new Map(); } }
  const x = SCRIP.get(t);
  if (!x || !/-EQ$/.test(x.fullSymbol || "")) return null;
  return encodeURIComponent(x.symbol) + ".NS";
}
const IST = 5.5 * 3600 * 1000;
export async function getYahooCandles(token, tf = "5") {
  const sym = symbolFor(token);
  if (!sym) throw new Error("no Yahoo symbol for token " + token);
  const key = `${token}_${tf}`, hit = g.__yahooCache.get(key);
  if (hit && Date.now() - hit.at < 45000) return hit.bars;
  const interval = tf === "15" ? "15m" : "5m";
  const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}`, { params: { interval, range: "5d" }, timeout: 7000, headers: { "User-Agent": "Mozilla/5.0" } });
  const r = res.data?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error("Yahoo returned no candles");
  const q = r.indicators.quote[0], bars = [], step = (tf === "15" ? 15 : 5) * 60;
  r.timestamp.forEach((ts, i) => {
    if (q.close[i] == null || q.open[i] == null) return;
    const b = Math.floor(ts / step) * step; // snap Yahoo's trailing "live point" into its candle bucket
    const iso = new Date(b * 1000 + IST).toISOString(), clock = iso.slice(11, 16);
    if (clock < "09:15" || clock > "15:29") return;
    const last = bars[bars.length - 1], v = q.volume[i] || 0;
    if (last && last.time === b) { last.high = Math.max(last.high, +q.high[i].toFixed(2)); last.low = Math.min(last.low, +q.low[i].toFixed(2)); last.close = +q.close[i].toFixed(2); last.volume += v; }
    else bars.push({ time: b, date: iso.slice(0, 10), clock, open: +q.open[i].toFixed(2), high: +q.high[i].toFixed(2), low: +q.low[i].toFixed(2), close: +q.close[i].toFixed(2), volume: v || 1 });
  });
  if (bars.length < 5) throw new Error("Yahoo returned too few candles");
  g.__yahooCache.set(key, { at: Date.now(), bars });
  return bars;
}
