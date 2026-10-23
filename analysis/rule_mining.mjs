// analysis/rule_mining.mjs - mine many chart/candle rules on 44 stocks x 63 days (5m), costs included, 70/30 chronological split.
// Entry next-bar open; SL/TP = ATR(14) multiples (SL first if both hit); exit 15:10 close; 1 trade per stock/day/rule.
// PASS needs: test n>=100, test PF>=1.3, test net>0, train net>0, and both test sub-halves net>0. With ~hundreds of configs some pass by luck, so
// a pass is only a candidate for forward paper testing, not proof.
import fs from "fs"; import path from "path";
import { signalPoints } from "../lib/signalPoints.js";
const COST = 0.0006, DIR = path.join(process.cwd(), "data", "movers", "5m");
const S = {};
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith("_5m.json"))) { const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")); const m = new Map(); for (const c of j.candles) { if (!m.has(c.date)) m.set(c.date, []); m.get(c.date).push(c); } S[j.meta.symbol] = m; }
const days = [...new Set(Object.values(S).flatMap((m) => [...m.keys()]))].sort();
const split = days[Math.floor(days.length * 0.7)], mid2 = days[Math.floor(days.length * 0.85)];
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
const EV = {}; // rule -> [{d,s,i,dir,b,atr}]
const add = (r, o) => (EV[r] = EV[r] || []).push(o);
for (const [s, m] of Object.entries(S)) for (const [d, b] of m) {
  if (b.length < 40) continue;
  const cl = b.map((x) => x.close), e9 = ema(cl, 9), e21 = ema(cl, 21);
  const tr = b.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low));
  const atr = []; let a = tr[0]; tr.forEach((t, i) => { a = i < 14 ? (a * i + t) / (i + 1) : (a * 13 + t) / 14; atr.push(a); });
  const taken = new Set(); const ev = (r, i, dir) => { const k = r + dir; if (taken.has(k) || i < 15 || i >= b.length - 2 || b[i].clock < "09:45" || b[i].clock > "14:00") return; taken.add(k); add(r, { d, i, dir, b, atr: atr[i] }); };
  for (const p of signalPoints(b)) { const i = b.findIndex((x) => `${x.date} ${x.clock}` === p.key); if (i >= 0) ev("sp_" + p.rule, i, p.side === "BUY" ? 1 : -1); }
  for (let i = 15; i < b.length - 2; i++) {
    const x = b[i], p = b[i - 1], body = Math.abs(x.close - x.open) || 1e-9;
    const hh = Math.max(...b.slice(i - 20 < 0 ? 0 : i - 20, i).map((y) => y.high)), ll = Math.min(...b.slice(i - 20 < 0 ? 0 : i - 20, i).map((y) => y.low));
    if (x.close > hh) ev("donchian20", i, 1); if (x.close < ll) ev("donchian20", i, -1);
    if (x.high < p.high && x.low > p.low && false) {}
    if (p.high - p.low > 0 && x.high < p.high && x.low > p.low) { const n = b[i + 1]; if (n && n.close > p.high) ev("insideBreak", i + 1, 1); if (n && n.close < p.low) ev("insideBreak", i + 1, -1); }
    if (e9[i] > e21[i] && x.low <= e21[i] * 1.0005 && x.close > e9[i] && x.close > x.open) ev("pullbackTrend", i, 1);
    if (e9[i] < e21[i] && x.high >= e21[i] * 0.9995 && x.close < e9[i] && x.close < x.open) ev("pullbackTrend", i, -1);
    if (x.close > x.open && p.close < p.open && x.close >= p.open && x.open <= p.close && x.low <= ll * 1.001) ev("engulfAtExtreme", i, 1);
    if (x.close < x.open && p.close > p.open && x.close <= p.open && x.open >= p.close && x.high >= hh * 0.999) ev("engulfAtExtreme", i, -1);
    if (Math.min(x.open, x.close) - x.low >= 2 * body && x.close > x.open && x.low <= ll * 1.001) ev("pinBar", i, 1);
    if (x.high - Math.max(x.open, x.close) >= 2 * body && x.close < x.open && x.high >= hh * 0.999) ev("pinBar", i, -1);
  }
  // ORB fakeout: breaks the opening range then closes back inside within 3 bars -> fade
  const oh = Math.max(...b.slice(0, 3).map((x) => x.high)), ol = Math.min(...b.slice(0, 3).map((x) => x.low));
  for (let i = 3; i < b.length - 3; i++) { if (b[i].close > oh) { for (let k = i + 1; k <= i + 3; k++) if (b[k].close < oh) { ev("orbFakeout", k, -1); break; } break; } }
  for (let i = 3; i < b.length - 3; i++) { if (b[i].close < ol) { for (let k = i + 1; k <= i + 3; k++) if (b[k].close > ol) { ev("orbFakeout", k, 1); break; } break; } }
}
function sim(r, sl, tp, flip) {
  return (EV[r] || []).map((o) => { const { b, i, atr } = o, dir = flip ? -o.dir : o.dir, e = b[i + 1].open, R = atr * sl, T = atr * tp, stop = e - dir * R, tgt = e + dir * T; let x = null;
    for (let k = i + 1; k < b.length; k++) { if (dir === 1 ? b[k].low <= stop : b[k].high >= stop) { x = stop; break; } if (dir === 1 ? b[k].high >= tgt : b[k].low <= tgt) { x = tgt; break; } if (b[k].clock >= "15:10") { x = b[k].close; break; } }
    if (x == null) x = b[b.length - 1].close; return { d: o.d, pct: ((x - e) * dir) / e - COST }; });
}
const agg = (r) => { const n = r.length; if (!n) return { n: 0, win: 0, pf: 0, net: 0 }; const w = r.filter((x) => x.pct > 0), gp = w.reduce((a, x) => a + x.pct, 0), gl = -r.filter((x) => x.pct <= 0).reduce((a, x) => a + x.pct, 0); return { n, win: +(w.length / n * 100).toFixed(1), pf: gl ? +(gp / gl).toFixed(2) : 99, net: +(r.reduce((a, x) => a + x.pct, 0) * 100).toFixed(2) }; };
const out = [];
for (const r of Object.keys(EV)) for (const flip of [false, true]) for (const sl of [0.75, 1, 1.5]) for (const tp of [1, 1.5, 2, 3]) {
  const rs = sim(r, sl, tp, flip), tr = agg(rs.filter((x) => x.d < split)), te = agg(rs.filter((x) => x.d >= split)), A = agg(rs.filter((x) => x.d >= split && x.d < mid2)), B = agg(rs.filter((x) => x.d >= mid2));
  out.push({ rule: r, flip, sl, tp, events: EV[r].length, train: tr, test: te, testA: A.net, testB: B.net, pass: te.n >= 100 && te.pf >= 1.3 && te.net > 0 && tr.net > 0 && A.net > 0 && B.net > 0 });
}
fs.writeFileSync(path.join(process.cwd(), "analysis", "rule_mining.json"), JSON.stringify(out, null, 1));
console.log("rules", Object.keys(EV).map((r) => r + ":" + EV[r].length).join(" "));
console.log("configs", out.length, "passed", out.filter((x) => x.pass).length);
out.filter((x) => x.test.n >= 100).sort((a, b) => b.test.pf - a.test.pf).slice(0, 8).forEach((x) => console.log(x.rule, x.flip ? "FADE" : "FOLLOW", x.sl, x.tp, "train", JSON.stringify(x.train), "test", JSON.stringify(x.test)));
