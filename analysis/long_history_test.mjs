// analysis/long_history_test.mjs - ~2 years of 60-minute bars (44 stocks, Yahoo unofficial) to test simple rules across several market regimes.
// One position per stock/rule at a time; entry next-bar open; SL/TP = ATR(14, hourly) multiples (SL first); max hold H bars (same day = until 15:15, or 21 bars ~3 days).
// Costs: 0.06% round trip for same-day exits, 0.15% for multi-day holds (rough, delivery-style STT etc.). Chronological split: train 60% / test 40%;
// test is split in 2 halves. PASS = test n>=150, test PF>=1.3, test net>0, train net>0, both test halves net>0. Many configs -> some pass by luck.
import fs from "fs"; import path from "path";
const DIR = path.join(process.cwd(), "data", "movers", "60m");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("_60m.json") && !/^(NIFTY|BANKNIFTY)_/.test(f));
const DATA = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));
const alld = [...new Set(DATA.flatMap((j) => j.candles.map((c) => c.date)))].sort();
const s1 = alld[Math.floor(alld.length * 0.6)], s2 = alld[Math.floor(alld.length * 0.8)];
console.log("stocks", DATA.length, "days", alld.length, alld[0], "->", alld[alld.length - 1], "train<", s1, "testA<", s2);
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
function rsi(cl, n) { const o = cl.map(() => 50); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
const RULES = {
  donchian20: (c, i, I) => { let hh = -1e9, ll = 1e9; for (let k = i - 20; k < i; k++) { hh = Math.max(hh, c[k].high); ll = Math.min(ll, c[k].low); } return c[i].close > hh ? 1 : c[i].close < ll ? -1 : 0; },
  emaCross: (c, i, I) => (I.e9[i] > I.e21[i] && I.e9[i - 1] <= I.e21[i - 1] ? 1 : I.e9[i] < I.e21[i] && I.e9[i - 1] >= I.e21[i - 1] ? -1 : 0),
  rsiMomo: (c, i, I) => (I.r[i] > 60 && I.r[i - 1] <= 60 ? 1 : I.r[i] < 40 && I.r[i - 1] >= 40 ? -1 : 0),
  rsiRevert: (c, i, I) => (I.r[i] < 25 ? 1 : I.r[i] > 75 ? -1 : 0),
  pullbackTrend: (c, i, I) => (I.e9[i] > I.e21[i] && I.e21[i] > I.e50[i] && c[i].low <= I.e21[i] && c[i].close > I.e9[i] ? 1 : I.e9[i] < I.e21[i] && I.e21[i] < I.e50[i] && c[i].high >= I.e21[i] && c[i].close < I.e9[i] ? -1 : 0),
  prevDayBreak: (c, i, I) => { if (c[i].date === c[i - 1].date && I.first[i] === i) return 0; const pd = I.pday[i]; if (!pd) return 0; return c[i].close > pd.h && c[i - 1].close <= pd.h ? 1 : c[i].close < pd.l && c[i - 1].close >= pd.l ? -1 : 0; },
  gapFade: (c, i, I) => { if (I.first[i] !== i) return 0; const pd = I.pday[i]; if (!pd) return 0; const g = (c[i].open - pd.c) / pd.c; return g > 0.01 ? -1 : g < -0.01 ? 1 : 0; },
  gapGo: (c, i, I) => { if (I.first[i] !== i) return 0; const pd = I.pday[i]; if (!pd) return 0; const g = (c[i].open - pd.c) / pd.c; return g > 0.01 && c[i].close > c[i].open ? 1 : g < -0.01 && c[i].close < c[i].open ? -1 : 0; },
};
const TR = {}; for (const r of Object.keys(RULES)) TR[r] = [];
const prepped = DATA.map((j) => {
  const c = j.candles, cl = c.map((x) => x.close), tr = c.map((x, i) => (i ? Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)) : x.high - x.low));
  const atr = []; let a = tr[0]; tr.forEach((t, i) => { a = i < 14 ? (a * i + t) / (i + 1) : (a * 13 + t) / 14; atr.push(a); });
  const first = [], pday = []; let fi = 0, days = []; // first[i] = index of first bar of its day; pday[i] = previous day's {h,l,c}
  for (let i = 0; i < c.length; i++) { if (i === 0 || c[i].date !== c[i - 1].date) { fi = i; days.push({ d: c[i].date, h: c[i].high, l: c[i].low, c: c[i].close }); } else { const D = days[days.length - 1]; D.h = Math.max(D.h, c[i].high); D.l = Math.min(D.l, c[i].low); D.c = c[i].close; } first.push(fi); pday.push(days.length >= 2 ? days[days.length - 2] : null); }
  return { s: j.meta.symbol, c, atr, I: { e9: ema(cl, 9), e21: ema(cl, 21), e50: ema(cl, 50), r: rsi(cl, 14), first, pday } };
});
function simulate(rule, sl, tp, hold, flip, cost) {
  const out = [];
  for (const P of prepped) { const { c, atr, I } = P; let busy = -1;
    for (let i = 52; i < c.length - 2; i++) { if (i <= busy) continue; let dir = RULES[rule](c, i, I); if (!dir) continue; if (flip) dir = -dir;
      const e = c[i + 1].open, R = atr[i] * sl, T = atr[i] * tp, stop = e - dir * R, tgt = e + dir * T; let x = null, q = i + 1;
      for (; q < c.length; q++) { if (dir === 1 ? c[q].low <= stop : c[q].high >= stop) { x = stop; break; } if (dir === 1 ? c[q].high >= tgt : c[q].low <= tgt) { x = tgt; break; }
        if (hold === "day" ? (q === c.length - 1 || c[q + 1].date !== c[q].date) : q - (i + 1) >= 20) { x = c[q].close; break; } }
      if (x == null) { x = c[c.length - 1].close; q = c.length - 1; }
      busy = q; out.push({ d: c[i].date, pct: ((x - e) * dir) / e - cost }); } }
  return out;
}
const agg = (r) => { const n = r.length; if (!n) return { n: 0, win: 0, pf: 0, net: 0 }; const gp = r.filter((x) => x.pct > 0).reduce((a, x) => a + x.pct, 0), gl = -r.filter((x) => x.pct <= 0).reduce((a, x) => a + x.pct, 0); return { n, win: +(r.filter((x) => x.pct > 0).length / n * 100).toFixed(1), pf: gl ? +(gp / gl).toFixed(2) : 99, net: +(r.reduce((a, x) => a + x.pct, 0) * 100).toFixed(1), avg: +(r.reduce((a, x) => a + x.pct, 0) / n * 100).toFixed(3) }; };
const res = [];
for (const rule of Object.keys(RULES)) for (const flip of [false, true]) for (const hold of ["day", "3d"]) for (const sl of [1, 1.5, 2]) for (const tp of [1, 2, 3]) {
  const rs = simulate(rule, sl, tp, hold, flip, hold === "day" ? 0.0006 : 0.0015);
  const tr = agg(rs.filter((x) => x.d < s1)), A = agg(rs.filter((x) => x.d >= s1 && x.d < s2)), B = agg(rs.filter((x) => x.d >= s2)), te = agg(rs.filter((x) => x.d >= s1));
  res.push({ rule, mode: flip ? "FADE" : "FOLLOW", hold, sl, tp, train: tr, test: te, testA: A.net, testB: B.net, pass: te.n >= 150 && te.pf >= 1.3 && te.net > 0 && tr.net > 0 && A.net > 0 && B.net > 0 });
}
fs.writeFileSync(path.join(process.cwd(), "analysis", "long_history_test.json"), JSON.stringify(res, null, 1));
console.log("configs", res.length, "passed", res.filter((x) => x.pass).length);
for (const x of res.filter((x) => x.test.n >= 150).sort((a, b) => b.test.pf - a.test.pf).slice(0, 10)) console.log(x.rule, x.mode, x.hold, x.sl, x.tp, "train", JSON.stringify(x.train), "test", JSON.stringify(x.test), "halves", x.testA, x.testB);
