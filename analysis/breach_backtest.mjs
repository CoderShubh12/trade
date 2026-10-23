// analysis/breach_backtest.mjs - does a first ORB breach, confirmed by multi-stock breadth, follow through for the next 3 bars?
// Honest test: 70/30 chronological split by day, direction hit-rate with Wilson 95% interval, vs a same-direction baseline.
// node analysis/breach_backtest.mjs   (reads data/movers/5m/*_5m.json). Writes analysis/breach_summary.json. No costs modelled: this is a
// DIRECTION test only, not a profit test.
import fs from "fs";
import path from "path";
const DIR = path.join(process.cwd(), "data", "movers", "5m");
const H = Number(process.env.HORIZON || 3);
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("_5m.json"));
const stocks = {};
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const byDay = new Map();
  for (const c of j.candles) { if (!byDay.has(c.date)) byDay.set(c.date, []); byDay.get(c.date).push(c); }
  stocks[j.meta.symbol] = byDay;
}
const days = [...new Set(Object.values(stocks).flatMap((m) => [...m.keys()]))].sort();
const split = days[Math.floor(days.length * 0.7)];
// per stock/day: ORB (first 3 bars), cumulative VWAP per bar
function prep(bars) {
  if (bars.length < 20) return null;
  const orbH = Math.max(...bars.slice(0, 3).map((b) => b.high)), orbL = Math.min(...bars.slice(0, 3).map((b) => b.low));
  let pv = 0, vv = 0; const vwap = [];
  for (const b of bars) { const tp = (b.high + b.low + b.close) / 3; pv += tp * (b.volume || 0); vv += b.volume || 0; vwap.push(vv ? pv / vv : b.close); }
  return { bars, orbH, orbL, vwap };
}
const P = {};
for (const [s, m] of Object.entries(stocks)) for (const [d, bars] of m) { const p = prep(bars); if (p) (P[d] = P[d] || {})[s] = p; }
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [(c - a) / d, (c + a) / d]; }
const R = { train: { all: [0, 0], agree: [0, 0], disagree: [0, 0], base: [0, 0] }, test: { all: [0, 0], agree: [0, 0], disagree: [0, 0], base: [0, 0] } };
const add = (g, hit) => { g[1]++; if (hit) g[0]++; };
for (const d of days) {
  const set = d < split ? R.train : R.test;
  const day = P[d]; if (!day) continue;
  for (const [s, p] of Object.entries(day)) {
    const { bars, orbH, orbL, vwap } = p;
    let doneUp = false, doneDn = false;
    for (let i = 3; i + H < bars.length && bars[i].clock < "14:00"; i++) {
      const c = bars[i].close;
      const dirUp = c > orbH && !doneUp, dirDn = c < orbL && !doneDn;
      if (!dirUp && !dirDn) continue;
      if (dirUp) doneUp = true; if (dirDn) doneDn = true;
      const dir = dirUp ? 1 : -1;
      const hit = (bars[i + H].close - c) * dir > 0;
      // breadth at this bar across all OTHER stocks that day: share above their own VWAP
      let up = 0, n = 0;
      for (const [s2, p2] of Object.entries(day)) { if (s2 === s || !p2.bars[i]) continue; n++; if (p2.bars[i].close > p2.vwap[i]) up++; }
      const breadth = n ? up / n : 0.5;
      const agree = dir === 1 ? breadth >= 0.6 : breadth <= 0.4, disagree = dir === 1 ? breadth <= 0.4 : breadth >= 0.6;
      add(set.all, hit); if (agree) add(set.agree, hit); if (disagree) add(set.disagree, hit);
      // baseline: the next bar's same-direction move 3 bars later, for a random-ish reference (bar i-1)
      // baseline: any random bar in same stock/day moving in this direction over H bars (no breach condition)
      const j = 3 + ((i * 7) % Math.max(1, bars.length - H - 4));
      add(set.base, (bars[j + H].close - bars[j].close) * dir > 0);
    }
  }
}
const fmt = (g) => { const [k, n] = g; const [lo, hi] = wilson(k, n); return { n, hit: n ? +(k / n * 100).toFixed(1) : null, ci95: [+(lo * 100).toFixed(1), +(hi * 100).toFixed(1)] }; };
const out = { horizonBars: H, days: days.length, split, stocks: Object.keys(stocks).length };
for (const k of ["train", "test"]) out[k] = Object.fromEntries(Object.entries(R[k]).map(([a, g]) => [a, fmt(g)]));
fs.writeFileSync(path.join(process.cwd(), "analysis", "breach_summary.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
