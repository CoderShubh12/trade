// Daily factor scan (plain node): node analysis/factor_scan.mjs
// RESEARCH ONLY. ~150 technical/price-volume factors per stock-day (fundamentals have no point-in-time history here, so none are included).
// For each factor: cross-sectional Spearman IC vs forward return (signal at close t, enter next open, exit close of day t+1+h), h = 5 and 20 trading days.
// Sampled every h days (non-overlapping) so the t-stat is not inflated. Ranked on TRAIN (<= 2023), judged on TEST (>= 2024). No costs in IC; top-quintile
// spread is shown net of a 0.6% round trip. Survivorship caveat: today's liquid names. Multiple-testing: ~300 tests, so ~15 will look "significant" by chance.
import fs from "fs";
import path from "path";
const SPLIT = "2024-01-01";
const stocks = {};
for (const d of ["data/daily", "data/movers/daily"]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => x.endsWith("_1d.json"))) {
  const sym = f.replace("_1d.json", ""); if (stocks[sym]) continue;
  const c = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")).candles.filter((b) => b.close > 0 && b.high >= b.low && b.volume >= 0);
  if (c.length > 500) stocks[sym] = c;
}
const NIFTY = stocks["NIFTY_50"]; for (const k of ["NIFTY_50", "BANK_NIFTY", "NIFTY 50"]) delete stocks[k];
const syms = Object.keys(stocks);
const sma = (v, p) => { const o = new Array(v.length).fill(NaN); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
const ema = (v, p) => { const k = 2 / (p + 1), o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(v[i] * k + o[i - 1] * (1 - k)); return o; };
const rsi = (v, p) => { const o = new Array(v.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1], u = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= p) { g += u / p; l += dn / p; } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + dn) / p; } if (i >= p) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; };
const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
const win = (arr, i, n) => arr.slice(i - n + 1, i + 1);
const nmap = new Map(); if (NIFTY) NIFTY.forEach((b, i) => nmap.set(b.date, i));
// factor table per stock: F[name][i]
const names = [], F = {};
const add = (n, arr) => { if (!F[n]) { F[n] = {}; names.push(n); } };
const feats = {};
for (const s of syms) {
  const c = stocks[s], n = c.length, cl = c.map((b) => b.close), op = c.map((b) => b.open), hi = c.map((b) => b.high), lo = c.map((b) => b.low), vo = c.map((b) => b.volume);
  const r1 = cl.map((v, i) => (i ? v / cl[i - 1] - 1 : NaN));
  const o = {};
  const put = (name, fn) => { const a = new Array(n).fill(NaN); for (let i = 260; i < n; i++) { const v = fn(i); a[i] = Number.isFinite(v) ? v : NaN; } o[name] = a; };
  for (const L of [1, 2, 3, 5, 10, 15, 20, 40, 60, 90, 126, 189, 252]) put(`ret${L}`, (i) => cl[i] / cl[i - L] - 1);
  for (const L of [60, 126, 252]) put(`ret${L}_skip21`, (i) => cl[i - 21] / cl[i - L] - 1);
  for (const P of [5, 10, 20, 50, 100, 200]) { const m = sma(cl, P); put(`distSMA${P}`, (i) => cl[i] / m[i] - 1); const e = ema(cl, P); put(`distEMA${P}`, (i) => cl[i] / e[i] - 1); }
  const sm50 = sma(cl, 50), sm200 = sma(cl, 200), sm20 = sma(cl, 20); put("sma50v200", (i) => sm50[i] / sm200[i] - 1); put("sma20v50", (i) => sm20[i] / sm50[i] - 1);
  for (const P of [2, 3, 5, 7, 14, 21]) { const r = rsi(cl, P); put(`rsi${P}`, (i) => r[i]); }
  const tr = c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - cl[i - 1]), Math.abs(b.low - cl[i - 1])) : b.high - b.low));
  for (const P of [5, 14, 30]) { const a = sma(tr, P); put(`atrPct${P}`, (i) => a[i] / cl[i]); }
  for (const P of [5, 10, 20, 60, 126]) put(`vol${P}`, (i) => std(win(r1, i, P)));
  put("volRatio5_20", (i) => std(win(r1, i, 5)) / std(win(r1, i, 20))); put("volRatio20_60", (i) => std(win(r1, i, 20)) / std(win(r1, i, 60)));
  const v20 = sma(vo, 20), v5 = sma(vo, 5), v60 = sma(vo, 60);
  put("volu_ratio1_20", (i) => vo[i] / v20[i]); put("volu_ratio5_20", (i) => v5[i] / v20[i]); put("volu_ratio20_60", (i) => v20[i] / v60[i]);
  const tn = sma(c.map((b) => b.close * b.volume), 20); put("logTurnover20", (i) => Math.log(tn[i] + 1));
  for (const P of [10, 20, 55, 126, 252]) { put(`posRange${P}`, (i) => { const h = Math.max(...win(hi, i, P)), l = Math.min(...win(lo, i, P)); return (cl[i] - l) / (h - l); }); put(`nearHigh${P}`, (i) => cl[i] / Math.max(...win(hi, i, P)) - 1); put(`nearLow${P}`, (i) => cl[i] / Math.min(...win(lo, i, P)) - 1); }
  put("gap1", (i) => op[i] / cl[i - 1] - 1); put("gapAvg5", (i) => win(c.map((b, k) => (k ? b.open / cl[k - 1] - 1 : 0)), i, 5).reduce((x, y) => x + y, 0) / 5);
  put("intraday1", (i) => cl[i] / op[i] - 1); put("intradayAvg5", (i) => win(c.map((b) => b.close / b.open - 1), i, 5).reduce((x, y) => x + y, 0) / 5); put("intradayAvg20", (i) => win(c.map((b) => b.close / b.open - 1), i, 20).reduce((x, y) => x + y, 0) / 20);
  put("closeLocation", (i) => (hi[i] === lo[i] ? 0.5 : (cl[i] - lo[i]) / (hi[i] - lo[i]))); put("closeLoc5", (i) => win(c.map((b) => (b.high === b.low ? 0.5 : (b.close - b.low) / (b.high - b.low))), i, 5).reduce((x, y) => x + y, 0) / 5);
  put("range1Pct", (i) => (hi[i] - lo[i]) / cl[i]); put("bodyPct", (i) => Math.abs(cl[i] - op[i]) / cl[i]);
  for (const P of [5, 10, 20, 60]) put(`upFrac${P}`, (i) => win(r1, i, P).filter((x) => x > 0).length / P);
  for (const P of [20, 60]) { put(`skew${P}`, (i) => { const w = win(r1, i, P), m = w.reduce((x, y) => x + y, 0) / P, s = std(w); return w.reduce((x, y) => x + ((y - m) / s) ** 3, 0) / P; }); put(`maxRet${P}`, (i) => Math.max(...win(r1, i, P))); put(`minRet${P}`, (i) => Math.min(...win(r1, i, P))); }
  for (const P of [20, 60, 126]) put(`maxDD${P}`, (i) => { let pk = -Infinity, dd = 0; for (const x of win(cl, i, P)) { pk = Math.max(pk, x); dd = Math.min(dd, x / pk - 1); } return dd; });
  const e12 = ema(cl, 12), e26 = ema(cl, 26), macd = e12.map((v, i) => v - e26[i]), sig = ema(macd, 9); put("macdHist", (i) => (macd[i] - sig[i]) / cl[i]); put("macd", (i) => macd[i] / cl[i]);
  for (const P of [10, 20]) put(`bbPctB${P}`, (i) => { const w = win(cl, i, P), m = w.reduce((x, y) => x + y, 0) / P, s = std(w); return s ? (cl[i] - (m - 2 * s)) / (4 * s) : NaN; });
  put("cci20", (i) => { const tp = c.map((b) => (b.high + b.low + b.close) / 3), w = win(tp, i, 20), m = w.reduce((x, y) => x + y, 0) / 20, md = w.reduce((x, y) => x + Math.abs(y - m), 0) / 20; return (tp[i] - m) / (0.015 * md); });
  put("stoch14", (i) => { const h = Math.max(...win(hi, i, 14)), l = Math.min(...win(lo, i, 14)); return (cl[i] - l) / (h - l); });
  put("amihud20", (i) => win(r1, i, 20).reduce((x, y, k) => x + Math.abs(y) / (win(c.map((b) => b.close * b.volume), i, 20)[k] || 1), 0));
  put("priceLog", (i) => Math.log(cl[i]));
  put("obvSlope20", (i) => { let ob = 0, a = []; for (let k = i - 20; k <= i; k++) { ob += Math.sign(r1[k] || 0) * vo[k]; a.push(ob); } return (a[20] - a[0]) / (v20[i] * 20); });
  put("corrNifty60", (i) => { if (!NIFTY) return NaN; const a = [], b = []; for (let k = i - 59; k <= i; k++) { const j = nmap.get(c[k].date); if (j === undefined || !j) return NaN; a.push(r1[k]); b.push(NIFTY[j].close / NIFTY[j - 1].close - 1); } const ma = a.reduce((x, y) => x + y) / 60, mb = b.reduce((x, y) => x + y) / 60; let cv = 0, va = 0, vb = 0; for (let k = 0; k < 60; k++) { cv += (a[k] - ma) * (b[k] - mb); va += (a[k] - ma) ** 2; vb += (b[k] - mb) ** 2; } return cv / Math.sqrt(va * vb); });
  put("beta60", (i) => { if (!NIFTY) return NaN; const a = [], b = []; for (let k = i - 59; k <= i; k++) { const j = nmap.get(c[k].date); if (j === undefined || !j) return NaN; a.push(r1[k]); b.push(NIFTY[j].close / NIFTY[j - 1].close - 1); } const ma = a.reduce((x, y) => x + y) / 60, mb = b.reduce((x, y) => x + y) / 60; let cv = 0, vb = 0; for (let k = 0; k < 60; k++) { cv += (a[k] - ma) * (b[k] - mb); vb += (b[k] - mb) ** 2; } return cv / vb; });
  for (const L of [5, 20, 60, 126]) put(`rsNifty${L}`, (i) => { if (!NIFTY) return NaN; const j = nmap.get(c[i].date), j0 = nmap.get(c[i - L].date); if (j === undefined || j0 === undefined) return NaN; return (cl[i] / cl[i - L]) / (NIFTY[j].close / NIFTY[j0].close) - 1; });
  put("dow", (i) => new Date(c[i].date).getUTCDay());
  feats[s] = o;
}
const fnames = Object.keys(feats[syms[0]]);
// forward returns + date index
const dateSet = new Set(); for (const s of syms) for (const b of stocks[s]) dateSet.add(b.date);
const dates = [...dateSet].sort();
const idx = {}; for (const s of syms) { idx[s] = new Map(); stocks[s].forEach((b, i) => idx[s].set(b.date, i)); }
const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = new Array(a.length); let i = 0; while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return va && vb ? c / Math.sqrt(va * vb) : NaN; };
const COSTRT = 0.006;
const out = {};
for (const H of [5, 20]) {
  const res = {};
  for (const f of fnames) res[f] = { tr: [], te: [], trQ: [], teQ: [] };
  for (let di = 261; di < dates.length - H - 2; di += H) {
    const d = dates[di]; const pairs = [];
    for (const s of syms) { const i = idx[s].get(d); if (i === undefined || i + 1 + H >= stocks[s].length) continue; const c = stocks[s]; const fwd = c[i + 1 + H].close / c[i + 1].open - 1; pairs.push({ s, i, fwd }); }
    if (pairs.length < 30) continue;
    const univ = pairs.reduce((x, p) => x + p.fwd, 0) / pairs.length;
    for (const f of fnames) {
      const pp = pairs.filter((p) => Number.isFinite(feats[p.s][f][p.i])); if (pp.length < 30) continue;
      const ic = corr(rank(pp.map((p) => feats[p.s][f][p.i])), rank(pp.map((p) => p.fwd))); if (!Number.isFinite(ic)) continue;
      const sorted = pp.slice().sort((a, b) => feats[b.s][f][b.i] - feats[a.s][f][a.i]); const q = Math.floor(sorted.length / 5);
      const topEx = sorted.slice(0, q).reduce((x, p) => x + p.fwd, 0) / q - COSTRT - univ; // long top quintile (by factor value), excess over universe, after cost
      const botEx = sorted.slice(-q).reduce((x, p) => x + p.fwd, 0) / q - COSTRT - univ; // long bottom quintile
      (d < SPLIT ? res[f].tr : res[f].te).push(ic); (d < SPLIT ? res[f].trQ : res[f].teQ).push([topEx, botEx]);
    }
  }
  const t = (a) => (a.length > 5 ? (a.reduce((x, y) => x + y, 0) / a.length) / (std(a) / Math.sqrt(a.length)) : NaN);
  const m = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const rows = fnames.map((f) => {
    const r = res[f], dir = Math.sign(m(r.tr)) || 1; // direction chosen on TRAIN only
    const q = (arr, k) => m(arr.map((x) => x[k]));
    const k = dir > 0 ? 0 : 1;
    return { f, nTr: r.tr.length, nTe: r.te.length, icTr: m(r.tr), tTr: t(r.tr), icTe: m(r.te), tTe: t(r.te), dir, longExcessTr: q(r.trQ, k), longExcessTe: q(r.teQ, k) };
  }).filter((r) => Number.isFinite(r.tTr) && Number.isFinite(r.tTe));
  rows.sort((a, b) => Math.abs(b.tTr) - Math.abs(a.tTr));
  const hit = rows.filter((r) => Math.abs(r.tTr) >= 2 && Math.sign(r.icTe) === r.dir && Math.abs(r.tTe) >= 2);
  const pass = rows.filter((r) => Math.abs(r.tTr) >= 2 && Math.sign(r.icTe) === r.dir && r.longExcessTr > 0 && r.longExcessTe > 0);
  out[`h${H}`] = { factors: rows.length, trainSignificant: rows.filter((r) => Math.abs(r.tTr) >= 2).length, trainSigAndTestSameSignSig: hit.length, expectedByChance: +(rows.length * 0.05 * 0.05 / 1).toFixed(1), netPositiveBothHalves: pass.map((r) => r.f), top15: rows.slice(0, 15).map((r) => ({ f: r.f, icTr: +r.icTr.toFixed(4), tTr: +r.tTr.toFixed(1), icTe: +r.icTe.toFixed(4), tTe: +r.tTe.toFixed(1), exTr: +(r.longExcessTr * 100).toFixed(2), exTe: +(r.longExcessTe * 100).toFixed(2) })) };
}
console.log(JSON.stringify({ stocks: syms.length, dates: [dates[0], dates[dates.length - 1]], split: SPLIT, ...out }, null, 1));
fs.writeFileSync("analysis/factor_scan_summary.json", JSON.stringify({ stocks: syms.length, split: SPLIT, ...out }, null, 2));
