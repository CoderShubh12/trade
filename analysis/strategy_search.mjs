// analysis/strategy_search.mjs - honest grid search over indicator strategies on 44 stocks x 63 days of 5m bars.
// Entry next-bar open after a closed-bar signal; SL/TP in ATR(14) multiples (SL checked first if both hit); square-off 15:15; costs COST_PCT round trip.
// Train = first 70% of days, Test = last 30%. A config "passes" only if test n>=100, test PF>=1.3, test net>0 AND train net>0 AND both halves of test net>0.
import fs from "fs"; import path from "path";
const COST = Number(process.env.COST_PCT || 0.06) / 100;
const DIR = path.join(process.cwd(), "data", "movers", "5m");
const S = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith("_5m.json"))) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); const m = new Map();
  for (const c of j.candles) { if (!m.has(c.date)) m.set(c.date, []); m.get(c.date).push(c); }
  S[j.meta.symbol] = m;
}
const days = [...new Set(Object.values(S).flatMap((m) => [...m.keys()]))].sort();
const split = days[Math.floor(days.length * 0.7)], mid2 = days[Math.floor(days.length * 0.85)];
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
function rsi(cl, n) { const o = cl.map(() => 50); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
const IND = {};
for (const [s, m] of Object.entries(S)) for (const [d, b] of m) {
  if (b.length < 40) continue;
  const cl = b.map((x) => x.close); let pv = 0, vv = 0;
  const vw = b.map((x) => { pv += ((x.high + x.low + x.close) / 3) * (x.volume || 0); vv += x.volume || 0; return vv ? pv / vv : x.close; });
  const tr = b.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low));
  const atr = []; let a = tr[0]; tr.forEach((t, i) => { a = i < 14 ? (a * i + t) / (i + 1) : (a * 13 + t) / 14; atr.push(a); });
  const volAvg = b.map((_, i) => { let t = 0, c = 0; for (let k = Math.max(0, i - 20); k < i; k++) { t += b[k].volume || 0; c++; } return c ? t / c : 0; });
  (IND[d] = IND[d] || {})[s] = { b, vw, atr, e9: ema(cl, 9), e21: ema(cl, 21), r5: rsi(cl, 5), r14: rsi(cl, 14), volAvg, orbH: Math.max(...b.slice(0, 3).map((x) => x.high)), orbL: Math.min(...b.slice(0, 3).map((x) => x.low)) };
}
const STRATS = {
  orbBreak: (p, i) => (p.b[i].close > p.orbH && p.b[i - 1].close <= p.orbH ? 1 : p.b[i].close < p.orbL && p.b[i - 1].close >= p.orbL ? -1 : 0),
  orbFade: (p, i) => -STRATS.orbBreak(p, i),
  orbBreakVol: (p, i) => (p.b[i].volume > 1.5 * p.volAvg[i] ? STRATS.orbBreak(p, i) : 0),
  vwapCrossTrend: (p, i) => (p.b[i].close > p.vw[i] && p.b[i - 1].close <= p.vw[i - 1] && p.e9[i] > p.e21[i] ? 1 : p.b[i].close < p.vw[i] && p.b[i - 1].close >= p.vw[i - 1] && p.e9[i] < p.e21[i] ? -1 : 0),
  emaCross: (p, i) => (p.e9[i] > p.e21[i] && p.e9[i - 1] <= p.e21[i - 1] ? 1 : p.e9[i] < p.e21[i] && p.e9[i - 1] >= p.e21[i - 1] ? -1 : 0),
  rsiRevert: (p, i) => (p.r5[i] < 12 ? 1 : p.r5[i] > 88 ? -1 : 0),
  rsiMomo: (p, i) => (p.r14[i] > 65 && p.r14[i - 1] <= 65 ? 1 : p.r14[i] < 35 && p.r14[i - 1] >= 35 ? -1 : 0),
  vwapStretchRevert: (p, i) => { const z = (p.b[i].close - p.vw[i]) / p.atr[i]; return z < -2.5 ? 1 : z > 2.5 ? -1 : 0; },
  volSpikeMomo: (p, i) => (p.b[i].volume > 3 * p.volAvg[i] ? (p.b[i].close > p.b[i].open ? 1 : -1) : 0),
};
function simulate(name, sl, tp, endClock) {
  const rows = [];
  for (const d of days) { const day = IND[d]; if (!day) continue;
    for (const [s, p] of Object.entries(day)) { const { b } = p; let taken = 0;
      for (let i = 22; i < b.length - 2 && taken < 1; i++) {
        if (b[i].clock < "09:30" || b[i].clock > endClock) continue;
        const dir = STRATS[name](p, i); if (!dir) continue; taken++;
        const e = b[i + 1].open, R = p.atr[i] * sl, T = p.atr[i] * tp, stop = e - dir * R, tgt = e + dir * T; let x = null;
        for (let k = i + 1; k < b.length; k++) {
          const hi = b[k].high, lo = b[k].low;
          if (dir === 1 ? lo <= stop : hi >= stop) { x = stop; break; }
          if (dir === 1 ? hi >= tgt : lo <= tgt) { x = tgt; break; }
          if (b[k].clock >= "15:10") { x = b[k].close; break; }
        }
        if (x == null) x = b[b.length - 1].close;
        rows.push({ d, pct: ((x - e) * dir) / e - COST });
      } } }
  return rows;
}
const agg = (r) => { const n = r.length; if (!n) return { n: 0, win: 0, pf: 0, net: 0 }; const w = r.filter((x) => x.pct > 0), gp = w.reduce((a, x) => a + x.pct, 0), gl = -r.filter((x) => x.pct <= 0).reduce((a, x) => a + x.pct, 0); return { n, win: +(w.length / n * 100).toFixed(1), pf: gl ? +(gp / gl).toFixed(2) : 99, net: +(r.reduce((a, x) => a + x.pct, 0) * 100).toFixed(2) }; };
const out = [];
for (const name of Object.keys(STRATS)) for (const sl of [0.5, 1, 1.5, 2]) for (const tp of [0.5, 1, 1.5, 2, 3]) for (const end of ["11:30", "14:00"]) {
  const r = simulate(name, sl, tp, end), tr = agg(r.filter((x) => x.d < split)), te = agg(r.filter((x) => x.d >= split));
  const a = agg(r.filter((x) => x.d >= split && x.d < mid2)), b = agg(r.filter((x) => x.d >= mid2));
  out.push({ name, sl, tp, end, train: tr, test: te, testA: a.net, testB: b.net, pass: te.n >= 100 && te.pf >= 1.3 && te.net > 0 && tr.net > 0 && a.net > 0 && b.net > 0 });
}
fs.writeFileSync(path.join(process.cwd(), "analysis", "strategy_search.json"), JSON.stringify(out, null, 1));
const passed = out.filter((x) => x.pass);
console.log("configs", out.length, "passed", passed.length, "cost%", COST * 100);
console.log("best by TEST PF (n>=100):"); out.filter((x) => x.test.n >= 100).sort((a, b) => b.test.pf - a.test.pf).slice(0, 6).forEach((x) => console.log(x.name, x.sl, x.tp, x.end, "train", JSON.stringify(x.train), "test", JSON.stringify(x.test)));
console.log("highest TEST win% (n>=100):"); out.filter((x) => x.test.n >= 100).sort((a, b) => b.test.win - a.test.win).slice(0, 4).forEach((x) => console.log(x.name, x.sl, x.tp, x.end, "test", JSON.stringify(x.test)));
