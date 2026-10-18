// Daily / swing study (plain node, no bundling): node analysis/daily_swing.mjs
// Why daily: the intraday 5m rules lose about -0.5R per trade mostly to fixed costs. On daily bars a trade moves several % so costs matter far less.
// DIAGNOSTIC. Long-only (delivery trades; shorting needs futures). Signal at the close, entry at the NEXT open + slippage, exits on daily OHLC
// (gap through the stop exits at the open). Costs: 0.25% round trip (STT 0.1% x2 + stamp/exchange/GST + brokerage, conservative) + 0.05% slippage per side.
// Data: data/daily + data/movers/daily (87 stocks, 2018-10 -> 2026-10). Survivorship caveat: the list is today's liquid names, which flatters old years.
// Discipline: configs are RANKED ON TRAIN (<= 2023-12-31) and judged on TEST (>= 2024-01-01). Every config is also compared with a CONTROL
// (same exit rules, entering on random days without any signal) so market drift is not mistaken for edge. Gate: n >= 300, PF >= 1.3 on both halves,
// positive net on both halves, and the average trade beats the control on both halves.
import fs from "fs";
import path from "path";

const SLIP = 0.0005, COST = 0.0025, SPLIT = "2024-01-01";
const dirs = ["data/daily", "data/movers/daily"];
const stocks = {};
for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => x.endsWith("_1d.json"))) {
  const sym = f.replace("_1d.json", "");
  if (stocks[sym]) continue;
  const c = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")).candles.filter((b) => b.close > 0 && b.high >= b.low);
  if (c.length > 400) stocks[sym] = c;
}
const NIFTY = stocks["NIFTY_50"] || stocks["NIFTY 50"]; delete stocks["NIFTY_50"]; delete stocks["BANK_NIFTY"]; delete stocks["NIFTY 50"];
const syms = Object.keys(stocks);

// ---- indicators ----
const sma = (v, p) => { const o = new Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
const ema = (v, p) => { const k = 2 / (p + 1), o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(v[i] * k + o[i - 1] * (1 - k)); return o; };
const rsi = (v, p) => { const o = new Array(v.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], u = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= p) { g += u / p; l += dn / p; } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + dn) / p; } if (i >= p) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; };
const atrS = (c, p = 14) => { const o = new Array(c.length).fill(NaN); let a = 0; for (let i = 1; i < c.length; i++) { const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); a = i <= p ? a + tr / p : (a * (p - 1) + tr) / p; if (i >= p) o[i] = a; } return o; };
const rollMax = (v, p) => v.map((_, i) => (i < p ? NaN : Math.max(...v.slice(i - p, i)))); // previous p bars, excluding i
const rollMin = (v, p) => v.map((_, i) => (i < p ? NaN : Math.min(...v.slice(i - p, i))));

const IND = {};
const nifty = NIFTY ? (() => { const cl = NIFTY.map((b) => b.close), s200 = sma(cl, 200), m = new Map(); NIFTY.forEach((b, i) => m.set(b.date, cl[i] > s200[i])); return m; })() : new Map();
for (const s of syms) {
  const c = stocks[s], cl = c.map((b) => b.close), hi = c.map((b) => b.high), lo = c.map((b) => b.low);
  const turn = sma(c.map((b) => b.close * b.volume), 20);
  IND[s] = { cl, s5: sma(cl, 5), s50: sma(cl, 50), s200: sma(cl, 200), e20: ema(cl, 20), r2: rsi(cl, 2), r14: rsi(cl, 14), atr: atrS(c), hh20: rollMax(hi, 20), hh55: rollMax(hi, 55), hh252: rollMax(hi, 252), ll10: rollMin(lo, 10), hh10: rollMax(hi, 10), turn,
    ret126: cl.map((v, i) => (i >= 131 ? cl[i - 5] / cl[i - 131] - 1 : NaN)) };
}

// ---- signal definitions (evaluated at close of day i; long only) ----
const SIG = {
  "Donchian 20d breakout + above SMA200": (x, i) => x.cl[i] > x.hh20[i] && x.cl[i] > x.s200[i],
  "Donchian 55d breakout + above SMA200": (x, i) => x.cl[i] > x.hh55[i] && x.cl[i] > x.s200[i],
  "52-week-high proximity (within 2%) + above SMA200": (x, i) => x.cl[i] >= 0.98 * x.hh252[i] && x.cl[i] > x.s200[i],
  "RSI(2) < 10 pullback in uptrend (SMA200)": (x, i) => x.r2[i] < 10 && x.cl[i] > x.s200[i],
  "RSI(2) < 5 pullback in uptrend (SMA200)": (x, i) => x.r2[i] < 5 && x.cl[i] > x.s200[i],
  "Trend pullback: SMA50>SMA200, close<=EMA20, RSI14<45": (x, i) => x.s50[i] > x.s200[i] && x.cl[i] <= x.e20[i] && x.r14[i] < 45,
  "Breakout of 10d high after a tight range (ATR% < 2.2)": (x, i) => x.cl[i] > x.hh10[i] && (100 * x.atr[i]) / x.cl[i] < 2.2 && x.cl[i] > x.s50[i],
};
// ---- exit sets ----
const EXITS = [];
for (const stop of [2, 3]) for (const hold of [5, 10, 20, 40]) for (const trail of [0, 3]) EXITS.push({ stop, hold, trail, name: `stop ${stop}ATR, hold ${hold}d${trail ? `, trail ${trail}ATR` : ""}` });
const MEANREV_EXIT = (name) => /RSI\(2\)/.test(name);

function trade(c, x, i, E, useRsiExit) {
  const e = i + 1, n = c.length;
  if (e >= n || !(x.atr[i] > 0)) return null;
  const entry = c[e].open * (1 + SLIP);
  let stop = entry - E.stop * x.atr[i], hiC = entry, px = null, j = e;
  for (; j < Math.min(n, e + E.hold); j++) {
    if (c[j].open <= stop) { px = c[j].open; break; }
    if (c[j].low <= stop) { px = stop; break; }
    if (useRsiExit && j > e && (c[j].close > x.s5[j] || x.r2[j] > 60)) { px = c[j].close; break; } // mean-reversion exit
    if (E.trail) { hiC = Math.max(hiC, c[j].close); stop = Math.max(stop, hiC - E.trail * x.atr[i]); }
    if (j === Math.min(n, e + E.hold) - 1) { px = c[j].close; break; }
  }
  if (px === null) return null;
  px *= 1 - SLIP;
  return { ret: px / entry - 1 - COST, risk: (E.stop * x.atr[i]) / entry, exit: j, date: c[i].date };
}
const liquid = (x, i) => x.turn[i] > 5e7; // avg daily turnover > Rs 5 crore

function runConfig(sig, E, mode) { // mode "signal" or "control"
  const out = [];
  for (const s of syms) {
    const c = stocks[s], x = IND[s], f = SIG[sig], useR = MEANREV_EXIT(sig);
    let free = 0, last = -99;
    for (let i = 210; i < c.length - 2; i++) {
      if (i <= free || !liquid(x, i)) continue;
      if (mode === "control") { if (i - last < 7) continue; if (!(x.s200[i] > 0)) continue; last = i; } // every 7th day, no signal
      else if (!f(x, i)) continue;
      const t = trade(c, x, i, E, mode === "signal" && useR);
      if (t) { out.push(t); free = t.exit; }
    }
  }
  return out;
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const pf = (a) => { let w = 0, l = 0; for (const v of a) v > 0 ? (w += v) : (l -= v); return l > 0 ? w / l : w > 0 ? 99 : 0; };
const st = (a) => ({ n: a.length, win: a.length ? (100 * a.filter((v) => v > 0).length) / a.length : NaN, avg: 100 * mean(a), pf: pf(a) });
const P = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const half = (t) => [t.filter((z) => z.date < SPLIT).map((z) => z.ret), t.filter((z) => z.date >= SPLIT).map((z) => z.ret)];

const t0 = Date.now();
const controlCache = {};
const results = [];
for (const sig of Object.keys(SIG)) for (const E of EXITS) {
  if (MEANREV_EXIT(sig) && E.trail) continue;
  const tr = runConfig(sig, E, "signal");
  if (tr.length < 100) continue;
  const key = E.name;
  const ctl = controlCache[key] || (controlCache[key] = runConfig(sig, E, "control"));
  const [a, b] = half(tr), [ca, cb] = half(ctl);
  const all = st(tr.map((z) => z.ret)), A = st(a), B = st(b), CA = st(ca), CB = st(cb);
  const years = {}; for (const z of tr) { const y = z.date.slice(0, 4); (years[y] = years[y] || []).push(z.ret); }
  const yrs = Object.entries(years).filter(([, v]) => v.length >= 20).map(([y, v]) => [y, 100 * mean(v)]);
  const pass = all.n >= 300 && A.pf >= 1.3 && B.pf >= 1.3 && A.avg > 0 && B.avg > 0 && A.avg > CA.avg && B.avg > CB.avg;
  results.push({ sig, exit: E.name, all, A, B, CA, CB, yrsPos: yrs.filter(([, v]) => v > 0).length, yrsN: yrs.length, years: yrs, pass });
}
console.log(`DAILY SWING  ${syms.length} stocks, ${Object.values(stocks)[0][0].date} -> ${Object.values(stocks)[0].slice(-1)[0].date}, split ${SPLIT}, ${results.length} configs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`Costs: ${100 * COST}% round trip + ${100 * SLIP}% slippage per side. Average net % per trade; control = same exits, random entries without a signal.\n`);
const line = (r) => `${r.sig.slice(0, 46).padEnd(46)} ${r.exit.padEnd(36)} n=${String(r.all.n).padStart(5)} | TRAIN avg ${P(r.A.avg).padStart(5)}% PF ${P(r.A.pf).padStart(4)} (ctl ${P(r.CA.avg).padStart(5)}%) | TEST avg ${P(r.B.avg).padStart(5)}% PF ${P(r.B.pf).padStart(4)} win ${P(r.B.win, 0)}% (ctl ${P(r.CB.avg).padStart(5)}%) | yrs+ ${r.yrsPos}/${r.yrsN}`;
const byTrain = results.filter((r) => r.A.n >= 150 && r.B.n >= 100).sort((p, q) => q.A.avg - p.A.avg);
console.log("TOP 12 BY TRAIN AVG (then judged on TEST)"); byTrain.slice(0, 12).forEach((r) => console.log(line(r)));
console.log("\nBEST BY TEST AVG (shown for information; picking by test would be overfitting)"); [...byTrain].sort((p, q) => q.B.avg - p.B.avg).slice(0, 8).forEach((r) => console.log(line(r)));
const posBoth = results.filter((r) => r.A.avg > 0 && r.B.avg > 0), beatCtl = results.filter((r) => r.A.avg > r.CA.avg && r.B.avg > r.CB.avg);
console.log(`\nConfigs: ${results.length}. Positive net on both halves: ${posBoth.length}. Beat the control on both halves: ${beatCtl.length}. PASS gate: ${results.filter((r) => r.pass).length}.`);
console.log(`Control (no signal) average per trade: train ${P(mean(Object.values(controlCache).map((c) => st(half(c)[0].map((v) => v)).avg)))}%, test ${P(mean(Object.values(controlCache).map((c) => st(half(c)[1]).avg)))}% (this is mostly market drift).`);
for (const r of results.filter((q) => q.pass).sort((p, q) => q.B.avg - p.B.avg).slice(0, 10)) console.log("PASS", line(r));

// ---- cross-sectional momentum: monthly rebalance, hold top K by 6-month return (skip last week) vs the equal-weight universe ----
const dates = [...new Set(Object.values(stocks).flatMap((c) => c.map((b) => b.date)))].sort();
const idxOf = {}; for (const s of syms) { idxOf[s] = new Map(); stocks[s].forEach((b, i) => idxOf[s].set(b.date, i)); }
const reb = []; for (let k = 250; k < dates.length - 1; k++) if (dates[k].slice(0, 7) !== dates[k + 1].slice(0, 7)) reb.push(dates[k]); // last trading day of each month
function momentum(K, useRegime) {
  const rows = []; let prev = new Set();
  for (let r = 0; r < reb.length - 1; r++) {
    const d0 = reb[r], d1 = reb[r + 1], pool = [];
    for (const s of syms) { const i = idxOf[s].get(d0), j = idxOf[s].get(d1); if (i === undefined || j === undefined || i + 1 >= stocks[s].length || !liquid(IND[s], i) || !(IND[s].ret126[i] === IND[s].ret126[i])) continue; pool.push({ s, m: IND[s].ret126[i], i, j }); }
    if (pool.length < 40) continue;
    const ret = (p) => stocks[p.s][p.j].open / stocks[p.s][p.i + 1].open - 1; // open after signal -> open after next rebalance
    const ew = mean(pool.map(ret));
    pool.sort((a, b) => b.m - a.m);
    const pick = pool.slice(0, K), set = new Set(pick.map((p) => p.s)), changed = [...set].filter((s) => !prev.has(s)).length / K;
    const off = useRegime && nifty.get(d0) === false;
    const gross = off ? 0 : mean(pick.map(ret));
    const net = off ? 0 : gross - changed * (COST + 2 * SLIP);
    rows.push({ date: d0, net, ew, gross });
    prev = off ? new Set() : set;
  }
  return rows;
}
console.log("\nCROSS-SECTIONAL MOMENTUM (monthly, top K by 6m return skipping the last week, net of costs for the names changed) vs equal-weight universe");
console.log("config".padEnd(34), "TRAIN avg/mo".padStart(13), "(EW)".padStart(8), "TEST avg/mo".padStart(12), "(EW)".padStart(8), "test months", "test hit%");
const momOut = [];
for (const K of [10, 20]) for (const rg of [false, true]) {
  const rows = momentum(K, rg), a = rows.filter((z) => z.date < SPLIT), b = rows.filter((z) => z.date >= SPLIT);
  const o = { K, regime: rg, trainAvg: 100 * mean(a.map((z) => z.net)), trainEW: 100 * mean(a.map((z) => z.ew)), testAvg: 100 * mean(b.map((z) => z.net)), testEW: 100 * mean(b.map((z) => z.ew)), testN: b.length, hit: (100 * b.filter((z) => z.net > z.ew).length) / b.length };
  momOut.push(o);
  console.log(`top ${K}${rg ? " + Nifty>SMA200 regime" : ""}`.padEnd(34), `${P(o.trainAvg)}%`.padStart(13), `${P(o.trainEW)}%`.padStart(8), `${P(o.testAvg)}%`.padStart(12), `${P(o.testEW)}%`.padStart(8), String(o.testN).padStart(11), `${P(o.hit, 0)}%`.padStart(9));
}
fs.writeFileSync("analysis/daily_swing_summary.json", JSON.stringify({ note: "DIAGNOSTIC. Long-only daily/swing study with costs. Train <= 2023, test 2024+. Survivorship bias: today's liquid stock list.", split: SPLIT, configs: results.map((r) => ({ signal: r.sig, exit: r.exit, n: r.all.n, train: r.A, test: r.B, controlTrain: r.CA, controlTest: r.CB, yearsPositive: `${r.yrsPos}/${r.yrsN}`, pass: r.pass })), momentum: momOut }, null, 1));
console.log("\nWritten: analysis/daily_swing_summary.json");
