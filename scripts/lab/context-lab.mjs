// scripts/lab/context-lab.mjs
// PRE-REGISTERED test (rules fixed BEFORE running; not tuned after seeing results):
//   Context = Nifty return (day open -> close of 10:10 bar) and 5 heavyweights
//   (HDFCBANK ICICIBANK RELIANCE SBIN AXISBANK) all measured the same way.
//   BULL day: Nifty >= +0.30% and >=4/5 heavyweights > 0.   BEAR: mirror image.
//   H1 FOLLOW : on BULL buy / on BEAR short every stock whose own move agrees (|move|>=0.30%)
//   H2 FADE   : same stocks, opposite direction
//   H3 CONTROL: buy every stock every day (drift check)
//   Signal at close of 10:10 bar, fill at NEXT open +/-0.03% slippage, stop 1%
//   (checked on bar high/low, stop assumed hit first), else exit at close of 15:10 bar.
//   Rs 1 lakh per trade, full Indian intraday charges. Chronological 70/30 split by day.
//   PASS = on BOTH halves: PF>=1.3, expectancy>0, >=100 trades, and day-level t>=2 on the full set.
import fs from "node:fs";
import path from "node:path";
import { tradeCharges } from "../backtest/costs.mjs";

const DIR = "data/movers/5m";
const HEAVY = ["HDFCBANK", "ICICIBANK", "RELIANCE", "SBIN", "AXISBANK"];
const SLIP = 0.0003, STOP = 0.01, THR = 0.003, NOTIONAL = 100000;

const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}_5m.json`), "utf8")).candles;
const byDay = (c) => { const m = new Map(); for (const k of c) { if (!m.has(k.date)) m.set(k.date, []); m.get(k.date).push(k); } return m; };

const files = fs.readdirSync(DIR).map((f) => f.replace("_5m.json", ""));
const stocks = files.filter((n) => n !== "NIFTY_50" && n !== "BANK_NIFTY");
const days = {}; for (const n of files) days[n] = byDay(load(n));
const dates = [...days.NIFTY_50.keys()].sort();

const idx = (bars, clock) => bars.findIndex((b) => b.clock === clock);
const moveAt = (bars) => { const i = idx(bars, "10:10"); return i < 0 ? null : bars[i].close / bars[0].open - 1; };

function trade(bars, side) {
  const si = idx(bars, "10:10"), ei = idx(bars, "15:10");
  if (si < 0 || ei < 0 || !(bars[si + 1]?.volume > 0)) return null;
  const long = side === "L";
  const entry = bars[si + 1].open * (1 + (long ? SLIP : -SLIP));
  const stop = long ? entry * (1 - STOP) : entry * (1 + STOP);
  let exit = null;
  for (let i = si + 1; i <= ei; i++) {
    if (long ? bars[i].low <= stop : bars[i].high >= stop) { exit = stop; break; }
  }
  if (exit === null) exit = bars[ei].close;
  exit *= 1 + (long ? -SLIP : SLIP);
  const qty = Math.floor(NOTIONAL / entry); if (qty < 1) return null;
  const gross = (long ? exit - entry : entry - exit) * qty;
  const ch = long ? tradeCharges(qty, entry, exit).total : tradeCharges(qty, exit, entry).total;
  return gross - ch;
}

const results = { H1: [], H2: [], H3: [] };   // {date, pnl}
let bull = 0, bear = 0, flat = 0;
for (const d of dates) {
  const nb = days.NIFTY_50.get(d); const nm = nb && moveAt(nb);
  const hv = HEAVY.map((h) => days[h]?.get(d)).map((b) => b && moveAt(b));
  let ctx = 0;
  if (nm !== null && hv.every((x) => x !== null && x !== undefined)) {
    const up = hv.filter((x) => x > 0).length, dn = hv.filter((x) => x < 0).length;
    if (nm >= THR && up >= 4) ctx = 1; else if (nm <= -THR && dn >= 4) ctx = -1;
  }
  ctx === 1 ? bull++ : ctx === -1 ? bear++ : flat++;
  for (const s of stocks) {
    const b = days[s].get(d); if (!b) continue;
    const m = moveAt(b); if (m === null) continue;
    const c3 = trade(b, "L"); if (c3 !== null) results.H3.push({ d, p: c3 });
    if (ctx !== 0 && ((ctx === 1 && m >= THR) || (ctx === -1 && m <= -THR))) {
      const f = trade(b, ctx === 1 ? "L" : "S"), x = trade(b, ctx === 1 ? "S" : "L");
      if (f !== null) results.H1.push({ d, p: f });
      if (x !== null) results.H2.push({ d, p: x });
    }
  }
}

const cut = dates[Math.floor(dates.length * 0.7)];
function stats(arr) {
  const n = arr.length; if (!n) return { n: 0 };
  const w = arr.filter((t) => t.p > 0), l = arr.filter((t) => t.p <= 0);
  const gw = w.reduce((a, t) => a + t.p, 0), gl = -l.reduce((a, t) => a + t.p, 0);
  return { n, win: +(100 * w.length / n).toFixed(1), pf: gl ? +(gw / gl).toFixed(2) : Infinity, exp: +(arr.reduce((a, t) => a + t.p, 0) / n).toFixed(0), total: +arr.reduce((a, t) => a + t.p, 0).toFixed(0) };
}
function dayT(arr) {
  const m = new Map(); for (const t of arr) { const e = m.get(t.d) || [0, 0]; e[0] += t.p; e[1]++; m.set(t.d, e); }
  const v = [...m.values()].map(([s, n]) => s / n); const k = v.length; if (k < 3) return { days: k, t: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / k, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1));
  return { days: k, meanPerDay: +mean.toFixed(0), t: +(mean / (sd / Math.sqrt(k))).toFixed(2) };
}
let out = `# Context lab ${new Date().toISOString()}\nDays ${dates[0]}..${dates.at(-1)} (${dates.length}), split at ${cut}. Context days: BULL ${bull}, BEAR ${bear}, neutral ${flat}\n\n`;
for (const h of ["H1", "H2", "H3"]) {
  const a = results[h], tr = a.filter((t) => t.d < cut), te = a.filter((t) => t.d >= cut);
  const S = [stats(a), stats(tr), stats(te)], T = dayT(a);
  const pass = [tr, te].every((x) => { const s = stats(x); return s.n >= 100 && s.pf >= 1.3 && s.exp > 0; }) && T.t >= 2;
  out += `## ${h}  ${pass ? "PASS" : "FAIL"}\nall: ${JSON.stringify(S[0])}\nin-sample: ${JSON.stringify(S[1])}\nout-of-sample: ${JSON.stringify(S[2])}\nday-level: ${JSON.stringify(T)}\n\n`;
}
fs.mkdirSync("backtest-results", { recursive: true });
const f = `backtest-results/context-lab-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`;
fs.writeFileSync(f, out); console.log(out); console.log("saved", f);
