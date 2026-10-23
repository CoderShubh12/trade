// analysis/trade_autopsy3.mjs - 3-month (63 days, 44 stocks, 5m) autopsy of rule-triggered trades: WHY do some win and some lose, and which
// pockets (time of day, volatility vs cost, VWAP distance, volume, trend/breadth alignment, gap) are consistently positive in BOTH train and test?
// Trades: every causal rule trigger (lib/signalPoints.js rules + donchian/pullback/inside-bar/engulf/pin), FOLLOW direction, SL 1.5 ATR, TP 2 ATR,
// exit 15:10, cost 0.06% round trip. Winners-only analysis would be selection bias, so winners are compared with losers and every pocket is
// re-checked on the held-out 30%.
import fs from "fs"; import path from "path";
import { signalPoints } from "../lib/signalPoints.js";
const TF = Number(process.env.TF || 5), W = TF === 15 ? 6 : 15;
const COST = 0.0006, SL = 1.5, TP = 2, DIR = path.join(process.cwd(), "data", "movers", "5m");
const S = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith("_5m.json"))) { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); const m = new Map(); for (const c of j.candles) { if (!m.has(c.date)) m.set(c.date, []); m.get(c.date).push(c); } if (TF === 15) { for (const [d, b] of m) { const out = []; for (let i = 0; i < b.length; i += 3) { const g = b.slice(i, i + 3); out.push({ date: d, clock: g[0].clock, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g[g.length - 1].close, volume: g.reduce((a, x) => a + (x.volume || 0), 0) }); } m.set(d, out); } }
  S[j.meta.symbol] = m; }
const days = [...new Set(Object.values(S).flatMap((m) => [...m.keys()]))].sort();
const split = days[Math.floor(days.length * 0.7)];
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
const P = {}; // per stock/day prep
const B = {}; // breadth: day|clock -> [above-vwap flags]
for (const [s, m] of Object.entries(S)) for (const [d, b] of m) {
  if (b.length < (TF === 15 ? 14 : 40)) continue; let pv = 0, vv = 0;
  const vw = b.map((x) => { pv += ((x.high + x.low + x.close) / 3) * (x.volume || 0); vv += x.volume || 0; return vv ? pv / vv : x.close; });
  const cl = b.map((x) => x.close), e9 = ema(cl, 9), e21 = ema(cl, 21);
  const tr = b.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low));
  const atr = []; let a = tr[0]; tr.forEach((t, i) => { a = i < 14 ? (a * i + t) / (i + 1) : (a * 13 + t) / 14; atr.push(a); });
  P[s + "|" + d] = { b, vw, e9, e21, atr };
  b.forEach((x, i) => { const k = d + "|" + x.clock; (B[k] = B[k] || []).push([s, x.close > vw[i] ? 1 : 0]); });
}
const trades = [];
for (const [key, p] of Object.entries(P)) {
  const [s, d] = key.split("|"), { b, vw, e9, e21, atr } = p, taken = new Set();
  const take = (rule, i, dir) => {
    const k = rule + dir; if (taken.has(k) || i < W || i >= b.length - 2 || b[i].clock < "09:45" || b[i].clock > "14:00") return; taken.add(k);
    const e = b[i + 1].open, R = atr[i] * SL, T = atr[i] * TP, stop = e - dir * R, tgt = e + dir * T; let x = null;
    for (let q = i + 1; q < b.length; q++) { if (dir === 1 ? b[q].low <= stop : b[q].high >= stop) { x = stop; break; } if (dir === 1 ? b[q].high >= tgt : b[q].low <= tgt) { x = tgt; break; } if (b[q].clock >= "15:10") { x = b[q].close; break; } }
    if (x == null) x = b[b.length - 1].close;
    const pct = ((x - e) * dir) / e - COST;
    let sum = 0, n = 0; for (const [s2, f] of B[d + "|" + b[i].clock] || []) if (s2 !== s) { sum += f; n++; } const br = n ? sum / n : 0.5;
    let vs = 0, vc = 0; for (let q = Math.max(0, i - 20); q < i; q++) { vs += b[q].volume || 0; vc++; }
    const dayOpen = b[0].open, prevClose = null;
    trades.push({ d, s, rule, dir, pct, win: pct > 0,
      time: b[i].clock < "10:30" ? "a 09:45-10:30" : b[i].clock < "11:30" ? "b 10:30-11:30" : b[i].clock < "13:00" ? "c 11:30-13:00" : "d 13:00-14:00",
      atrPct: (atr[i] / b[i].close) * 100, costInR: (COST * e) / (atr[i] * SL),
      vwapDist: ((b[i].close - vw[i]) / atr[i]) * dir, // >0 = price already stretched in trade direction
      volRatio: vc ? (b[i].volume || 0) / (vs / vc || 1) : 1,
      trend: (e9[i] > e21[i] ? 1 : -1) === dir ? "with EMA trend" : "against EMA trend",
      breadth: (dir === 1 ? br : 1 - br), // share of OTHER stocks on the trade's side of VWAP
      dow: new Date(d).getUTCDay(), gap: ((dayOpen - b[0].open) / b[0].open) });
  };
  for (const pt of (TF === 15 ? [] : signalPoints(b))) { const i = b.findIndex((x) => `${x.date} ${x.clock}` === pt.key); if (i >= 0 && !pt.rule.endsWith("?")) take("sp_" + pt.rule, i, pt.side === "BUY" ? 1 : -1); }
  for (let i = W; i < b.length - 2; i++) { const x = b[i], pp = b[i - 1];
    const hh = Math.max(...b.slice(Math.max(0, i - 20), i).map((y) => y.high)), ll = Math.min(...b.slice(Math.max(0, i - 20), i).map((y) => y.low)), body = Math.abs(x.close - x.open) || 1e-9;
    if (x.close > hh) take("donchian20", i, 1); if (x.close < ll) take("donchian20", i, -1);
    if (e9[i] > e21[i] && x.low <= e21[i] * 1.0005 && x.close > e9[i] && x.close > x.open) take("pullback", i, 1);
    if (e9[i] < e21[i] && x.high >= e21[i] * 0.9995 && x.close < e9[i] && x.close < x.open) take("pullback", i, -1);
    if (x.close > x.open && pp.close < pp.open && x.close >= pp.open && x.open <= pp.close && x.low <= ll * 1.001) take("engulf", i, 1);
    if (x.close < x.open && pp.close > pp.open && x.close <= pp.open && x.open >= pp.close && x.high >= hh * 0.999) take("engulf", i, -1);
  }
}
const agg = (r) => { const n = r.length; if (n < 30) return null; const gp = r.filter((x) => x.pct > 0).reduce((a, x) => a + x.pct, 0), gl = -r.filter((x) => x.pct <= 0).reduce((a, x) => a + x.pct, 0); return { n, win: +(r.filter((x) => x.win).length / n * 100).toFixed(1), pf: gl ? +(gp / gl).toFixed(2) : 99, net: +(r.reduce((a, x) => a + x.pct, 0) * 100).toFixed(2), avgPct: +(r.reduce((a, x) => a + x.pct, 0) / n * 100).toFixed(3) }; };
const tr = trades.filter((t) => t.d < split), te = trades.filter((t) => t.d >= split);
const out = { totalTrades: trades.length, train: agg(tr), test: agg(te), costDragPctAvg: +(COST * 100).toFixed(3), winnersVsLosers: {} };
const mean = (a, f) => (a.length ? +(a.reduce((x, t) => x + f(t), 0) / a.length).toFixed(3) : null);
for (const f of ["atrPct", "costInR", "vwapDist", "volRatio", "breadth"]) out.winnersVsLosers[f] = { winners: mean(trades.filter((t) => t.win), (t) => t[f]), losers: mean(trades.filter((t) => !t.win), (t) => t[f]) };
const buckets = {
  time: (t) => t.time, trend: (t) => t.trend, rule: (t) => t.rule, side: (t) => (t.dir === 1 ? "BUY" : "SELL"),
  atrPct: (t) => (t.atrPct < 0.25 ? "a <0.25%" : t.atrPct < 0.4 ? "b 0.25-0.4%" : t.atrPct < 0.6 ? "c 0.4-0.6%" : "d >0.6%"),
  costInR: (t) => (t.costInR < 0.1 ? "a <0.10R" : t.costInR < 0.2 ? "b 0.10-0.20R" : "c >0.20R"),
  vwapDist: (t) => (t.vwapDist < 0 ? "a against VWAP side" : t.vwapDist < 1.5 ? "b 0-1.5 ATR beyond" : t.vwapDist < 3 ? "c 1.5-3 ATR" : "d >3 ATR (stretched)"),
  volRatio: (t) => (t.volRatio < 1 ? "a <1x" : t.volRatio < 2 ? "b 1-2x" : "c >2x"),
  breadth: (t) => (t.breadth < 0.35 ? "a <35% agree" : t.breadth < 0.65 ? "b 35-65%" : "c >65% agree"),
  dow: (t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.dow],
};
out.buckets = {};
for (const [name, fn] of Object.entries(buckets)) {
  const keys = [...new Set(trades.map(fn))].sort(); out.buckets[name] = {};
  for (const k of keys) out.buckets[name][k] = { train: agg(tr.filter((t) => fn(t) === k)), test: agg(te.filter((t) => fn(t) === k)) };
}
// pockets positive in BOTH halves (net>0, PF>=1.1 each, n>=100 each)
out.consistentPockets = [];
for (const [name, v] of Object.entries(out.buckets)) for (const [k, x] of Object.entries(v)) if (x.train && x.test && x.train.n >= 100 && x.test.n >= 100 && x.train.net > 0 && x.test.net > 0 && x.train.pf >= 1.1 && x.test.pf >= 1.1) out.consistentPockets.push({ feature: name, bucket: k, train: x.train, test: x.test });
fs.writeFileSync(path.join(process.cwd(), "analysis", TF === 15 ? "trade_autopsy3_15m.json" : "trade_autopsy3.json"), JSON.stringify(out, null, 1));
console.log("trades", trades.length, "train", JSON.stringify(out.train), "test", JSON.stringify(out.test));
console.log("winners vs losers", JSON.stringify(out.winnersVsLosers));
for (const f of ["time", "atrPct", "costInR", "vwapDist", "volRatio", "breadth", "trend", "side", "rule"]) { console.log("--", f); for (const [k, x] of Object.entries(out.buckets[f])) console.log(" ", k.padEnd(24), "train", x.train ? `n${x.train.n} pf${x.train.pf} net${x.train.net}` : "-", "| test", x.test ? `n${x.test.n} pf${x.test.pf} net${x.test.net}` : "-"); }
console.log("CONSISTENT POCKETS", JSON.stringify(out.consistentPockets.map((p) => `${p.feature}=${p.bucket} tr ${p.train.pf}/${p.train.net} te ${p.test.pf}/${p.test.net}`)));
