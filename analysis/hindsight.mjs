// Hindsight ("reverse engineering") study. DIAGNOSTIC, not a trading rule.
// For every 5m bar inside the trade windows and BOTH directions, ask in hindsight: "if a trade had been opened at the next open
// (SL 1.2 ATR, target 2.0 ATR, 12-bar hold, costs + slippage), did it work?" Then look at what was visible at that bar's close
// (trend, VWAP, RSI, MACD, volume, opening range, gap, momentum, candle + chart patterns, the terminal's own score) and measure which
// factors were present before the good trades, and what the tool's own signal caught or missed.
// Chronological 70/30 split: a factor only counts if it also works on the later 30%. With ~50 factors, a few will look good by chance.
//   npx esbuild analysis/hindsight.mjs --bundle --platform=node --format=esm --outfile=analysis/.build/hindsight.mjs
//   node analysis/.build/hindsight.mjs [dir=data/movers/5m]   -> prints the report, writes analysis/hindsight_summary.json
import fs from "fs";
import path from "path";
import { buildCompositeScore } from "../lib/signalEngine";
import { detectChartPatterns, wilderATR } from "../lib/chartPatterns.js";
import { candleRead } from "../lib/autopsy.js";

const DIR = process.argv[2] || "data/movers/5m";
const RISK = 500, SLIP = 0.0003, CAP = 500000, SLM = 1.2, TGM = 2.0, HOLD = 12, WIN = 375;
const cost = (n) => 40 + 0.00035 * n;
const mins = (clk) => +clk.slice(0, 2) * 60 + +clk.slice(3, 5);
const inWindow = (m) => (m >= 570 && m <= 690) || (m >= 810 && m <= 885); // time the signal bar closed
const SKIP = new Set(["NIFTY_50", "BANK_NIFTY"]);

// ---- indicator series (whole history, only past data at each index) ----
const ema = (v, p) => { const k = 2 / (p + 1); const o = new Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = i ? v[i] * k + e * (1 - k) : v[0]; o[i] = e; } return o; };
function rsiSeries(cl, p = 14) { const o = new Array(cl.length).fill(50); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= p) { g += up / p; l += dn / p; } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; } if (i >= p) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
function atrSeries(c, p = 14) { const o = new Array(c.length).fill(0); let a = 0; for (let i = 1; i < c.length; i++) { const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); a = i <= p ? a + tr / p : (a * (p - 1) + tr) / p; o[i] = i >= p ? a : 0; } return o; }

function sim(c, i, side, atr) {
  const e = i + 1; if (e >= c.length || c[e].date !== c[i].date) return null;
  const entry = c[e].open * (1 + SLIP * side), risk = SLM * atr, stop = entry - side * risk, tgt = entry + side * TGM * atr;
  let px = null, hit = false;
  for (let j = e; j < Math.min(c.length, e + HOLD) && c[j].date === c[i].date; j++) {
    if (side === 1) { if (j === e && c[j].open <= stop) { px = c[j].open; break; } if (c[j].low <= stop) { px = stop; break; } if (c[j].high >= tgt) { px = tgt; hit = true; break; } }
    else { if (j === e && c[j].open >= stop) { px = c[j].open; break; } if (c[j].high >= stop) { px = stop; break; } if (c[j].low <= tgt) { px = tgt; hit = true; break; } }
    if (mins(c[j].clock) >= 910 || j === e + HOLD - 1 || j + 1 >= c.length || c[j + 1].date !== c[i].date) { px = c[j].close; break; }
  }
  if (px == null) return null;
  px *= 1 - SLIP * side;
  const qty = Math.min(RISK / risk, CAP / entry);
  return { r: (side * (px - entry) * qty - cost(qty * entry)) / RISK, hit };
}

// ---- factors. Each is evaluated for a direction d (+1 buy, -1 sell) at the signal bar; "aligned" = in the trade's direction ----
const FACTORS = [
  ["trend: EMA9 > EMA21 (aligned)", (x, d) => d * (x.e9 - x.e21) > 0],
  ["trend: price beyond EMA50 (aligned)", (x, d) => d * (x.px - x.e50) > 0],
  ["trend: EMA9 against the trade", (x, d) => d * (x.e9 - x.e21) < 0],
  ["VWAP: price on trade side", (x, d) => d * (x.px - x.vwap) > 0],
  ["VWAP: stretched > 1.5 ATR on trade side", (x, d) => d * (x.px - x.vwap) > 1.5 * x.atr],
  ["VWAP: price on the OTHER side (counter-VWAP)", (x, d) => d * (x.px - x.vwap) < 0],
  ["RSI in the tool's zone (56-68 buy / 32-44 sell)", (x, d) => (d > 0 ? x.rsi >= 56 && x.rsi <= 68 : x.rsi >= 32 && x.rsi <= 44)],
  ["RSI extreme with the trade (>70 buy / <30 sell)", (x, d) => (d > 0 ? x.rsi > 70 : x.rsi < 30)],
  ["RSI extreme against (oversold buy / overbought sell)", (x, d) => (d > 0 ? x.rsi < 30 : x.rsi > 70)],
  ["MACD histogram aligned", (x, d) => d * x.hist > 0],
  ["volume spike (>= 1.4x avg of last 10)", (x) => x.vr >= 1.4],
  ["volume dry (< 0.7x)", (x) => x.vr < 0.7],
  ["opening range: closed beyond it (aligned)", (x, d) => x.orDone && (d > 0 ? x.px > x.orH : x.px < x.orL)],
  ["opening range: still inside", (x) => x.orDone && x.px <= x.orH && x.px >= x.orL],
  ["opening range: closed beyond it AGAINST the trade", (x, d) => x.orDone && (d > 0 ? x.px < x.orL : x.px > x.orH)],
  ["gap at open aligned (> 0.3%)", (x, d) => d * x.gapPct > 0.3],
  ["gap at open against (> 0.3%)", (x, d) => d * x.gapPct < -0.3],
  ["momentum: last 3 bars moved > 1 ATR with the trade", (x, d) => d * x.mom3 > 1],
  ["momentum: last 3 bars moved > 1 ATR against (pullback entry)", (x, d) => d * x.mom3 < -1],
  ["location: within 0.5 ATR of day high (buy) / low (sell)", (x, d) => (d > 0 ? x.dHi - x.px <= 0.5 * x.atr : x.px - x.dLo <= 0.5 * x.atr)],
  ["location: > 3 ATR from day extreme in trade direction", (x, d) => (d > 0 ? x.dHi - x.px > 3 * x.atr : x.px - x.dLo > 3 * x.atr)],
  ["day so far up/down aligned (vs prev close)", (x, d) => d * (x.px - x.pc) > 0],
  ["calm: ATR% < 0.15", (x) => (100 * x.atr) / x.px < 0.15],
  ["active: ATR% > 0.30", (x) => (100 * x.atr) / x.px > 0.3],
  ["time: first hour (before 10:15)", (x) => x.m < 615],
  ["time: afternoon window (13:30+)", (x) => x.m >= 810],
  ["candle: engulfing aligned", (x, d) => x.cp.some((p) => p.id === (d > 0 ? "BULL_ENGULF" : "BEAR_ENGULF"))],
  ["candle: pin bar aligned (hammer buy / shooting star sell)", (x, d) => x.cp.some((p) => p.id === (d > 0 ? "HAMMER_PIN" : "SHOOTING_PIN"))],
  ["candle: pin bar against", (x, d) => x.cp.some((p) => p.id === (d > 0 ? "SHOOTING_PIN" : "HAMMER_PIN"))],
  ["candle: doji", (x) => x.cp.some((p) => p.id === "DOJI")],
  ["candle: inside bar", (x) => x.cp.some((p) => p.id === "INSIDE_BAR")],
  ["chart pattern aligned (any)", (x, d) => x.chart.some((p) => p.dir === d)],
  ["chart pattern against (any)", (x, d) => x.chart.some((p) => p.dir === -d)],
  ["TOOL: |score| >= 65 on the trade side", (x, d) => d * x.score >= 65],
  ["TOOL: |score| >= 45 on the trade side", (x, d) => d * x.score >= 45],
  ["TOOL: score on the other side (<= -45 for a buy)", (x, d) => d * x.score <= -45],
];
const NF = FACTORS.length;

// ---- build samples ----
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("_5m.json") && !SKIP.has(f.replace("_5m.json", "")));
const S = { date: [], sym: [], i: [], d: [], r: [], hit: [], bits: [] }; // bits: factor bitmask as two 32-bit ints
const lo = [], hi = [];
const t0 = Date.now();
for (const f of files) {
  const sym = f.replace("_5m.json", "");
  const c = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).candles.filter((b) => b.volume > 0);
  if (c.length < 300) continue;
  const cl = c.map((b) => b.close), e9 = ema(cl, 9), e21 = ema(cl, 21), e50 = ema(cl, 50), rs = rsiSeries(cl), at = atrSeries(c);
  const m12 = ema(cl, 12), m26 = ema(cl, 26), macd = m12.map((v, i) => v - m26[i]), sig = ema(macd, 9);
  let dayStart = 0, pv = 0, vv = 0, dHi = 0, dLo = 0, pc = 0, dayOpen = 0;
  for (let i = 0; i < c.length; i++) {
    if (i === 0 || c[i].date !== c[i - 1].date) { if (i) pc = c[i - 1].close; dayStart = i; pv = 0; vv = 0; dHi = -Infinity; dLo = Infinity; dayOpen = c[i].open; }
    pv += ((c[i].high + c[i].low + c[i].close) / 3) * c[i].volume; vv += c[i].volume; dHi = Math.max(dHi, c[i].high); dLo = Math.min(dLo, c[i].low);
    if (i < 60 || !pc || !at[i]) continue;
    const m = mins(c[i].clock) + 5;
    if (!inWindow(m)) continue;
    const orN = 6, orDone = i - dayStart >= orN;
    let orH = -Infinity, orL = Infinity; if (orDone) for (let k = dayStart; k < dayStart + orN; k++) { orH = Math.max(orH, c[k].high); orL = Math.min(orL, c[k].low); }
    let av = 0; for (let k = i - 10; k < i; k++) av += c[k].volume; av /= 10;
    const closed = c.slice(Math.max(0, i - WIN + 1), i + 1);
    const x = {
      px: cl[i], e9: e9[i], e21: e21[i], e50: e50[i], rsi: rs[i], hist: macd[i] - sig[i], vwap: pv / vv, atr: at[i], vr: av ? c[i].volume / av : 1,
      orDone, orH, orL, gapPct: (100 * (dayOpen - pc)) / pc, mom3: (cl[i] - cl[i - 3]) / at[i], dHi, dLo, pc, m,
      cp: candleRead(c, i), chart: detectChartPatterns(c.slice(Math.max(0, i - 250), i + 1)), score: buildCompositeScore(closed, 5, true).score,
    };
    const atrW = wilderATR(c.slice(Math.max(0, i - 250), i + 1)) || at[i];
    for (const d of [1, -1]) {
      const a = sim(c, i, d, atrW); if (!a) continue;
      let b0 = 0, b1 = 0; for (let k = 0; k < NF; k++) if (FACTORS[k][1](x, d)) { if (k < 32) b0 |= 1 << k; else b1 |= 1 << (k - 32); }
      S.date.push(c[i].date); S.sym.push(sym); S.i.push(i); S.d.push(d); S.r.push(a.r); S.hit.push(a.hit ? 1 : 0); S.bits.push([b0, b1]);
    }
  }
}
const N = S.r.length;
const dates = [...new Set(S.date)].sort(), cut = dates[Math.floor(dates.length * 0.7)];
const test = S.date.map((d) => d >= cut);
const has = (n, k) => (k < 32 ? (S.bits[n][0] >>> k) & 1 : (S.bits[n][1] >>> (k - 32)) & 1) === 1;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const pf = (x) => { let w = 0, l = 0; for (const v of x) v > 0 ? (w += v) : (l -= v); return l > 0 ? w / l : w > 0 ? Infinity : 0; };
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "-");

const all = { n: N, hit: mean(S.hit), meanR: mean(S.r), trainR: mean(S.r.filter((_, n) => !test[n])), testR: mean(S.r.filter((_, n) => test[n])) };
console.log(`HINDSIGHT  ${files.length} stocks, ${dates[0]} -> ${dates[dates.length - 1]}, ${N} (bar x direction) samples, split ${cut}, built in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`Rule behind every sample: next-open entry, SL 1.2 ATR, target 2.0 ATR, ${HOLD * 5}-min hold, costs + slippage.`);
console.log(`BASELINE (take every bar, either side): target hit ${f2(100 * all.hit, 1)}%, net ${f2(all.meanR, 3)}R/trade (train ${f2(all.trainR, 3)}, test ${f2(all.testR, 3)})\n`);

// ---- single factors ----
const rows = [];
for (let k = 0; k < NF; k++) {
  const idx = [], idxTr = [], idxTe = [];
  for (let n = 0; n < N; n++) if (has(n, k)) { idx.push(n); (test[n] ? idxTe : idxTr).push(n); }
  const R = (a) => a.map((n) => S.r[n]), H = (a) => a.map((n) => S.hit[n]);
  rows.push({ factor: FACTORS[k][0], n: idx.length, nTrain: idxTr.length, nTest: idxTe.length, hitPct: 100 * mean(H(idx)), lift: mean(H(idx)) / all.hit, rTrain: mean(R(idxTr)), rTest: mean(R(idxTe)), pfTest: pf(R(idxTe)), hitTest: 100 * mean(H(idxTe)) });
}
rows.sort((a, b) => b.rTest - a.rTest);
console.log("FACTORS, best to worst by net R/trade on the LATER 30% (n = samples where the factor was present)");
console.log("factor".padEnd(62), "n_test".padStart(7), "hit%".padStart(6), "lift".padStart(5), "R train".padStart(8), "R test".padStart(8), "PF test".padStart(8));
for (const r of rows) if (r.nTest >= 300) console.log(r.factor.padEnd(62), String(r.nTest).padStart(7), f2(r.hitTest, 1).padStart(6), f2(r.hitTest / (100 * all.hit)).padStart(5), f2(r.rTrain, 3).padStart(8), f2(r.rTest, 3).padStart(8), f2(r.pfTest).padStart(8));
const good = rows.filter((r) => r.nTrain >= 300 && r.nTest >= 300 && r.rTrain > 0 && r.rTest > 0);
console.log(`\nFactors with positive net R after costs on BOTH halves (n>=300 each): ${good.length}${good.length ? " -> " + good.map((r) => r.factor).join(" | ") : ""}`);

// ---- pairs of the 14 most promising factors ----
const top = rows.filter((r) => r.nTrain >= 300 && r.nTest >= 300).slice(0, 14).map((r) => FACTORS.findIndex((f) => f[0] === r.factor));
const pairs = [];
for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) {
  const tr = [], te = []; for (let n = 0; n < N; n++) if (has(n, top[a]) && has(n, top[b])) (test[n] ? te : tr).push(S.r[n]);
  if (tr.length >= 300 && te.length >= 300) pairs.push({ pair: `${FACTORS[top[a]][0]}  +  ${FACTORS[top[b]][0]}`, nTr: tr.length, nTe: te.length, rTr: mean(tr), rTe: mean(te), pfTe: pf(te) });
}
pairs.sort((p, q) => Math.min(q.rTr, q.rTe) - Math.min(p.rTr, p.rTe));
console.log("\nBEST PAIRS (ranked by the worse of the two halves, n >= 300 each)");
for (const p of pairs.slice(0, 8)) console.log(`  R train ${f2(p.rTr, 3).padStart(7)} | R test ${f2(p.rTe, 3).padStart(7)} | PF test ${f2(p.pfTe).padStart(5)} | n ${p.nTr}/${p.nTe}  ${p.pair}`);

// ---- what did the tool catch / miss? ----
const kT = FACTORS.findIndex((f) => f[0].startsWith("TOOL: |score| >= 65"));
let goodN = 0, goodCaught = 0, sigN = 0, sigGood = 0;
for (let n = 0; n < N; n++) { const g = S.hit[n] === 1, t = has(n, kT); if (g) { goodN++; if (t) goodCaught++; } if (t) { sigN++; if (g) sigGood++; } }
console.log(`\nTOOL vs HINDSIGHT: of ${goodN} samples where a trade reached its target, the tool's score (>= 65 on that side) was present on ${goodCaught} (${f2((100 * goodCaught) / goodN, 1)}%) and absent on ${goodN - goodCaught} (${f2((100 * (goodN - goodCaught)) / goodN, 1)}% missed).`);
console.log(`When the tool's score was >= 65: ${sigGood} of ${sigN} reached target (${f2((100 * sigGood) / sigN, 1)}%) vs ${f2(100 * all.hit, 1)}% for a random bar. Lift ${f2(sigGood / sigN / all.hit)}.`);
// factors over-represented before the good trades the tool MISSED
const missed = []; for (let n = 0; n < N; n++) if (S.hit[n] === 1 && !has(n, kT)) missed.push(n);
const rest = []; for (let n = 0; n < N; n++) if (!has(n, kT)) rest.push(n);
const comp = [];
for (let k = 0; k < NF; k++) { if (k === kT || FACTORS[k][0].startsWith("TOOL")) continue; const pm = missed.filter((n) => has(n, k)).length / missed.length, pr = rest.filter((n) => has(n, k)).length / rest.length; comp.push({ f: FACTORS[k][0], pm, pr, ratio: pr ? pm / pr : NaN }); }
comp.sort((a, b) => b.ratio - a.ratio);
console.log("\nWHAT WAS VISIBLE BEFORE THE GOOD TRADES THE TOOL MISSED (share of missed-good trades with the factor vs share of all non-signal bars)");
for (const c of comp.slice(0, 8)) console.log(`  ${f2(100 * c.pm, 1).padStart(5)}% vs ${f2(100 * c.pr, 1).padStart(5)}%  (x${f2(c.ratio)})  ${c.f}`);

// ---- 8 example missed trades with their factors ----
const examples = missed.filter((n) => test[n]).sort((a, b) => S.r[b] - S.r[a]).filter((_, q) => q % Math.max(1, Math.floor(missed.length / 60)) === 0).slice(0, 8).map((n) => ({
  sym: S.sym[n], date: S.date[n], barIndex: S.i[n], side: S.d[n] > 0 ? "BUY" : "SELL", netR: +S.r[n].toFixed(2), factors: FACTORS.filter((_, k) => has(n, k)).map((f) => f[0]),
}));
console.log("\nEXAMPLES (later 30%): good trades the tool did not signal, with the factors that were visible at the signal bar's close");
for (const e of examples) console.log(`  ${e.sym} ${e.date} ${e.side} +${e.netR}R: ${e.factors.join("; ")}`);

fs.writeFileSync("analysis/hindsight_summary.json", JSON.stringify({ generatedFor: `${files.length} stocks, ${dates[0]} -> ${dates[dates.length - 1]}`, split: cut, note: "DIAGNOSTIC. Hindsight labels; ~35 factors tested, some will look good by chance. A factor needs positive net R on BOTH halves AND a fresh out-of-sample period before it can become a rule.", baseline: all, factors: rows.map((r) => ({ ...r })), pairs: pairs.slice(0, 15), tool: { goodN, goodCaught, sigN, sigGood }, missedFactors: comp.slice(0, 12), examples }, null, 1));
console.log("\nWritten: analysis/hindsight_summary.json");
