// lib/tickCandles.js (server only)
// FALLBACK candles built from the live price quotes, used ONLY when Angel's historical candle API refuses (403 rate limit).
// Real prices, but: bars start when the server starts sampling (no history before that), and volume comes from the
// day-cumulative traded volume in the quote (difference between bars). Never mixed into Angel candles.
import fs from "fs";
import path from "path";

export const TICK_TF_MS = 5 * 60000;
const IST_MS = 330 * 60000;
const FILE = path.join(process.cwd(), "data", "tick-candles.json");
const g = globalThis;
const S = (g.__tickCandles = g.__tickCandles || { bars: new Map(), loaded: false, savedAt: 0 }); // token -> Map(bucketStart -> bar)

const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);

function load() {
  if (S.loaded) return;
  S.loaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (j.day !== istDay(Date.now())) return; // only today's bars
    for (const [tok, arr] of Object.entries(j.bars || {})) S.bars.set(tok, new Map(arr.map((b) => [b.t, b])));
  } catch { /* none yet */ }
}

function save(now) {
  if (now - S.savedAt < 60000) return;
  S.savedAt = now;
  try {
    const bars = {};
    for (const [tok, m] of S.bars) bars[tok] = [...m.values()];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ day: istDay(now), bars }));
  } catch { /* disk problems must never break the quote loop */ }
}

// Record one quote. cumVol = day-cumulative traded volume (0/NaN if unknown).
export function recordTick(token, ltp, cumVol, now = Date.now()) {
  load();
  token = String(token);
  if (!(ltp > 0)) return;
  let m = S.bars.get(token);
  if (!m) S.bars.set(token, (m = new Map()));
  const day = istDay(now);
  // drop yesterday's bars
  for (const [k, b] of m) if (istDay(k) !== day) m.delete(k);
  const t = Math.floor(now / TICK_TF_MS) * TICK_TF_MS;
  const cv = Number.isFinite(cumVol) && cumVol > 0 ? cumVol : 0;
  const b = m.get(t);
  if (!b) m.set(t, { t, o: ltp, h: ltp, l: ltp, c: ltp, v0: cv, v1: cv });
  else { b.h = Math.max(b.h, ltp); b.l = Math.min(b.l, ltp); b.c = ltp; if (cv) { if (!b.v0) b.v0 = cv; b.v1 = cv; } }
  save(now);
}

// Candles in the same shape as the Angel route returns (oldest first, forming bar included).
export function getTickCandles(token) {
  load();
  const m = S.bars.get(String(token));
  if (!m) return [];
  let bars = [...m.values()].sort((a, b) => a.t - b.t);
  // Keep only the latest gap-free run: if sampling stopped for a while (stock not watched), bars across the hole
  // would feed the indicators a fake continuous series, so everything before the last gap is dropped.
  let from = 0;
  for (let i = bars.length - 1; i > 0; i--) if (bars[i].t - bars[i - 1].t > TICK_TF_MS) { from = i; break; }
  bars = bars.slice(from);
  return bars.map((b, i) => {
    const prevEnd = i > 0 && bars[i - 1].v1 ? bars[i - 1].v1 : b.v0;
    const vol = b.vol != null ? b.vol : b.v1 && prevEnd ? Math.max(0, b.v1 - prevEnd) : 0;
    const ts = new Date(b.t + IST_MS).toISOString();
    return { time: Math.floor(b.t / 1000), date: ts.slice(0, 10), clock: ts.slice(11, 16), open: b.o, high: b.h, low: b.l, close: b.c, volume: vol || 1 };
  });
}

// 15-minute bars from the 5-minute live bars (3 per bucket, only buckets that are complete or forming).
export function getTickCandles15(token) {
  const five = getTickCandles(token);
  const out = [];
  for (const b of five) {
    const bucket = Math.floor(b.time / 900) * 900;
    const last = out[out.length - 1];
    if (last && last.time === bucket) { last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += b.volume; }
    else { const ts = new Date(bucket * 1000 + IST_MS).toISOString(); out.push({ time: bucket, date: ts.slice(0, 10), clock: ts.slice(11, 16), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }); }
  }
  return out;
}

// Seed today's earlier bars (09:15 ... now) from Angel candles fetched once. Existing live bars are never overwritten.
export function seedBars(token, angelBars, now = Date.now()) {
  load();
  token = String(token);
  const day = istDay(now);
  let m = S.bars.get(token);
  if (!m) S.bars.set(token, (m = new Map()));
  let added = 0;
  for (const b of angelBars || []) {
    if (b.date !== day) continue;
    const t = b.time * 1000;
    if (m.has(t)) continue;
    m.set(t, { t, o: b.open, h: b.high, l: b.low, c: b.close, v0: 0, v1: 0, vol: Number(b.volume) || 1, seeded: true });
    added++;
  }
  save(now + 61000); // force a write
  return added;
}
