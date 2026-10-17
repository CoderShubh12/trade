// Multi-stock Trade Autopsy: replays the TERMINAL'S OWN signal and trade logic over the recorded 5m history and explains why trades fail.
//   DIAGNOSTIC ONLY. It says why simulated trades lose. It is not a profitability claim and it changes nothing in the live tool.
//
// Logic used (imported from lib/, unchanged): buildCompositeScore (signalEngine), detectMarketRegime, signalMemory (re-arm/cooldown/3 per day),
//   evaluateTradeSetup (score >= 65 + Nifty bias + trade windows + ATR levels), monitorActiveTrade (T1->breakeven trail, T2, VWAP breach, time decay).
// Same conventions as analysis/pattern_test.mjs: signal at bar close, fill at the NEXT open +/-0.03% slippage, risk Rs 500, notional cap Rs 5 lakh,
//   cost Rs 40 + 0.035% of notional, 25-minute (5 bar) time stop, 70/30 chronological split. Nifty bias from NIFTY_50 candles (same +-0.2% rule as serverEngine).
// Not modelled: the engine's cross-stock limits (-3R/day, 3 losses in a row), because stocks are replayed independently. A 45-min cooldown after a losing trade IS modelled.
// Inside a bar the order of prices is pessimistic for the trade (BUY: open, low, high, close. SELL: open, high, low, close).
//
// Needs bundling because lib/ uses extensionless imports:
//   npx esbuild analysis/autopsy_batch.mjs --bundle --platform=node --format=esm --outfile=analysis/.build/autopsy_batch.mjs
//   node analysis/.build/autopsy_batch.mjs [dir=data/movers/5m]      -> prints the report, writes analysis/autopsy_summary.json
import fs from "fs";
import path from "path";
import { buildCompositeScore } from "../lib/signalEngine";
import { calculateATR } from "../lib/indicators";
import { detectMarketRegime } from "../lib/marketRegime";
import { newSignalMemory, observeScore, checkSignalAllowed, recordEntry, recordExit } from "../lib/signalMemory";
import { evaluateTradeSetup, monitorActiveTrade } from "../lib/tradeManager";
import { autopsyTrade } from "../lib/autopsy.js";

const DIR = process.argv[2] || "data/movers/5m";
const RISK = 500, SLIP = 0.0003, CAP = 500000, HOLD = 5, WINDOW_BARS = 375, LOSS_COOL_MIN = 45;
const cost = (n) => 40 + 0.00035 * n;
const hhmmOf = (ms) => { const d = new Date(ms + 330 * 60000); return d.getUTCHours() * 100 + d.getUTCMinutes(); };
const SKIP = new Set(["NIFTY_50", "BANK_NIFTY"]);
const SL_VARIANTS = [1.2, 1.6, 2.0];

const load = (file) => JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")).candles.filter((b) => b.volume > 0);
const files = fs.readdirSync(DIR).filter((x) => x.endsWith("_5m.json"));
const nifty = (() => {
  const f = files.find((x) => x.startsWith("NIFTY_50"));
  if (!f) return null;
  const c = load(f), openBy = {}, closeAt = new Map();
  for (const b of c) { if (!(b.date in openBy)) openBy[b.date] = b.open; closeAt.set(b.time, b.close); }
  return { openBy, closeAt };
})();
const biasAt = (bar) => {
  if (!nifty) return "NEUTRAL";
  const o = nifty.openBy[bar.date], cl = nifty.closeAt.get(bar.time);
  if (!o || cl == null) return "NEUTRAL";
  const pct = ((cl - o) / o) * 100;
  return pct <= -0.2 ? "BEARISH" : pct >= 0.2 ? "BULLISH" : "NEUTRAL";
};

// Score every evaluable bar once per stock (shared by all stop variants).
function scoreBars(c) {
  const sc = new Array(c.length).fill(null);
  for (let i = 60; i < c.length - 2; i++) {
    const h = hhmmOf(c[i].time * 1000 + 300000);
    if (h < 930 || h > 1445) continue;
    const closed = c.slice(Math.max(0, i - WINDOW_BARS + 1), i + 1);
    const b = buildCompositeScore(closed, 5, true);
    sc[i] = { score: b.score, vwap: b.ind?.latest?.vwap, closed, atr: null, regime: null };
  }
  return sc;
}

async function replay(sym, c, sc, slMult) {
  const out = [];
  let mem = null, coolUntil = 0;
  for (let i = 60; i < c.length - 2; i++) {
    const s = sc[i];
    if (!s) continue;
    const now = c[i].time * 1000 + 300000;
    if (now < coolUntil) continue;
    mem = observeScore(mem, s.score, c[i].date);
    if (Math.abs(s.score) < 65) continue;
    if (!checkSignalAllowed(mem, now).allowed) continue;
    if (s.atr === null) { s.atr = calculateATR(s.closed, 14); s.regime = detectMarketRegime(s.closed); }
    const setup = await evaluateTradeSetup(s.score, biasAt(c[i]), c[i], s.vwap, s.atr, { nowMs: now, bypassTimeWindow: false, useGroqValidation: false, symbol: sym, timeframe: "5", regime: s.regime });
    if (!setup || (setup.action !== "BUY" && setup.action !== "SELL")) continue;
    mem = recordEntry(mem, setup.action);
    const e = i + 1;
    if (e >= c.length || c[e].date !== c[i].date) continue;
    const side = setup.action === "BUY" ? 1 : -1;
    const safeAtr = Math.abs(setup.entry - setup.stopLoss) / 1.2;
    const entry = c[e].open * (1 + SLIP * side);
    const stop0 = +(entry - side * slMult * safeAtr).toFixed(2);
    const tr = { action: setup.action, entry, target1: +(entry + side * 2 * safeAtr).toFixed(2), target2: +(entry + side * 3.5 * safeAtr).toFixed(2), stopLoss: stop0, t1Reached: false, maxTime: now + 25 * 60000 };

    // walk the bars with the app's own monitorActiveTrade
    let px = null, why = "", xi = e, vp = 0, vv = 0;
    const dayStart = (() => { let d = i; while (d > 0 && c[d - 1].date === c[i].date) d--; return d; })();
    for (let k = dayStart; k <= i; k++) { const t = (c[k].high + c[k].low + c[k].close) / 3; vp += t * c[k].volume; vv += c[k].volume; }
    for (let j = e; j < c.length && c[j].date === c[e].date; j++) {
      const b = c[j], t0 = b.time * 1000;
      const vwap = vv > 0 ? vp / vv : entry;
      const pts = side > 0 ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      for (let p = 0; p < 4 && px === null; p++) {
        const st = monitorActiveTrade(tr, pts[p], vwap, p === 3 ? t0 + 299000 : p === 0 ? t0 : t0 + 60000 * p);
        if (st && st.exit) {
          xi = j; why = st.reason;
          if (st.reason === "STOP_LOSS_HIT" || st.reason === "TRAILING_SL_HIT") px = p === 0 ? pts[0] : tr.stopLoss;
          else if (st.reason === "TARGET_2_HIT") px = p === 0 ? pts[0] : tr.target2;
          else if (st.reason === "VWAP_BREACH_EXIT") { const lvl = vwap * (1 - side * 0.0005); px = p === 0 ? pts[0] : lvl; }
          else px = pts[p];
        }
      }
      if (px === null && (j - e + 1 >= HOLD || j + 1 >= c.length || c[j + 1].date !== c[e].date)) { px = b.close; xi = j; why = "TIME_DECAY_TIMEOUT"; }
      if (px !== null) break;
      const t = (b.high + b.low + b.close) / 3; vp += t * b.volume; vv += b.volume;
    }
    if (px === null) continue;
    px *= 1 - SLIP * side;
    const risk = slMult * safeAtr, qty = Math.min(RISK / risk, CAP / entry);
    const netR = (side * (px - entry) * qty - cost(qty * entry)) / RISK;
    const exitMs = c[xi].time * 1000 + 300000;
    const profit = tr.t1Reached || netR > 0;
    if (!profit) coolUntil = exitMs + LOSS_COOL_MIN * 60000;
    mem = recordExit(mem, exitMs);
    let dayEnd = e; while (dayEnd + 1 < c.length && c[dayEnd + 1].date === c[e].date) dayEnd++;
    out.push({
      sym, i, e, xi, side, netR, slMult, regime: s.regime, score: s.score, why,
      rec: { id: `${sym}-${c[e].time}`, symbol: sym, side: setup.action, dateStr: c[e].date, entryClock: c[e].clock, entry, stopLoss: stop0, initialSl: stop0, target1: tr.target1, exitPrice: px, exitClock: c[xi].clock, reason: why, feat: { eventRisk: "none" } },
      lo: Math.max(0, i - 260), hi: dayEnd,
    });
    i = xi; // next evaluation after the exit bar
  }
  return out;
}

const pf = (x) => { let w = 0, l = 0; for (const v of x) v > 0 ? (w += v) : (l -= v); return l > 0 ? w / l : w > 0 ? Infinity : 0; };
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const R = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const row = (x) => ({ n: x.length, win: x.length ? R((100 * x.filter((v) => v > 0).length) / x.length, 1) : null, pf: Number.isFinite(pf(x)) ? R(pf(x), 2) : (x.length ? 999 : null), avgNetR: R(mean(x)) });
const fmtRow = (r) => (r.n ? `n=${String(r.n).padStart(5)} win=${String(r.win).padStart(5)}% PF=${String(r.pf).padStart(5)} net/trade=${r.avgNetR >= 0 ? "+" : ""}${r.avgNetR}R` : "n=0");

const t0 = Date.now();
const per = {};          // sym -> candles
const base = [];         // baseline (1.2 ATR) autopsied trades
const variants = Object.fromEntries(SL_VARIANTS.map((m) => [m, []]));
let stocks = 0;
for (const file of files) {
  const sym = file.replace("_5m.json", "");
  if (SKIP.has(sym)) continue;
  const c = load(file);
  if (c.length < 200) continue;
  stocks++;
  const sc = scoreBars(c);
  for (const m of SL_VARIANTS) {
    const trades = await replay(sym, c, sc, m);
    for (const t of trades) {
      if (m === 1.2) {
        const rep = autopsyTrade(t.rec, c.slice(t.lo, t.hi + 1));
        if (!rep.error) base.push({ ...t, rep, c });
      } else {
        if (t.why === "STOP_LOSS_HIT") { const rep = autopsyTrade(t.rec, c.slice(t.lo, t.hi + 1)); t.noise = !rep.error && rep.noiseStop; }
        variants[m].push(t);
      }
    }
  }
  process.stderr.write(`${sym} done (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// ---------------- aggregate ----------------
const all = base.map((x) => x.netR);
const dates = [...new Set(base.map((x) => x.rep.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];
const trn = base.filter((x) => x.rep.date < cut).map((x) => x.netR), tst = base.filter((x) => x.rep.date >= cut).map((x) => x.netR);
const S = { generatedFor: `${stocks} stocks, ${dates[0]} -> ${dates[dates.length - 1]}`, note: "DIAGNOSTIC: why simulated trades fail. Not a profitability claim.", split: cut };
S.overall = { all: row(all), train: row(trn), test: row(tst) };

const losses = base.filter((x) => x.rep.outcome === "LOSS");
const causeN = {};
for (const x of losses) causeN[x.rep.cause] = (causeN[x.rep.cause] || 0) + 1;
S.losses = { n: losses.length, shareOfTrades: R((100 * losses.length) / base.length, 1), byCause: Object.fromEntries(Object.entries(causeN).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { n: v, pct: R((100 * v) / losses.length, 1), avgNetR: R(mean(losses.filter((x) => x.rep.cause === k).map((x) => x.netR))) }])) };

const group = (keyFn) => { const m = {}; for (const x of base) { const k = keyFn(x); if (k == null) continue; (m[k] = m[k] || []).push(x.netR); } return Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, row(v)])); };
S.byTimeOfDay = group((x) => x.rep.timeBucket);
S.byVwapSide = group((x) => (x.rep.tradedWithVwap === null ? null : x.rep.tradedWithVwap ? "with VWAP" : "against VWAP"));
S.bySide = group((x) => x.rep.side);
S.byRegime = group((x) => x.regime);
S.byLateEntry = group((x) => (x.rep.vwapDistAtr === null ? null : Math.abs(x.rep.vwapDistAtr) > 1.5 ? "entry >1.5 ATR from VWAP" : "entry within 1.5 ATR of VWAP"));
S.byExitReason = group((x) => x.why);
S.byPattern = group((x) => {
  const ch = x.rep.chartPatterns.some((p) => p.dir === x.side) ? "chart pattern WITH trade" : x.rep.chartPatterns.length ? "chart pattern AGAINST trade" : null;
  if (ch) return ch;
  const ca = x.rep.candlePatterns.some((p) => p.dir === x.side) ? "candle pattern WITH trade" : x.rep.candlePatterns.some((p) => p.dir === -x.side) ? "candle pattern AGAINST trade" : "no pattern";
  return ca;
});

// MFE: how far did trades run before they ended?
const buckets = [["<0.25R", -Infinity, 0.25], ["0.25-0.5R", 0.25, 0.5], ["0.5-1R", 0.5, 1], ["1-1.67R", 1, 1.667], [">=1.67R (T1 distance)", 1.667, Infinity]];
const mfe = (list) => Object.fromEntries(buckets.map(([k, a, b]) => [k, list.filter((x) => x.rep.mfeR >= a && x.rep.mfeR < b).length]));
S.mfe = {
  allTrades: mfe(base), losingTrades: mfe(losses),
  lossesThatReachedHalfR: R((100 * losses.filter((x) => x.rep.mfeR >= 0.5).length) / Math.max(1, losses.length), 1),
  lossesThatReached1R: R((100 * losses.filter((x) => x.rep.mfeR >= 1).length) / Math.max(1, losses.length), 1),
  lossesWhereT1WasReachable: R((100 * losses.filter((x) => x.rep.t1Reachable).length) / Math.max(1, losses.length), 1),
  avgGaveBackRLosses: R(mean(losses.map((x) => x.rep.gaveBackR))),
};

// Noise-stop rate: of the trades that ended on the stop, how many were wick-outs that recovered?
const stopOuts = (list) => list.filter((x) => x.why === "STOP_LOSS_HIT");
const nz = (x) => (x.rep ? x.rep.noiseStop : x.noise);
S.stopWidth = {};
for (const m of SL_VARIANTS) {
  const list = m === 1.2 ? base : variants[m];
  const so = stopOuts(list);
  S.stopWidth[`${m} ATR`] = { trades: list.length, stoppedOut: so.length, stopRatePct: R((100 * so.length) / Math.max(1, list.length), 1), noiseStopPctOfStops: R((100 * so.filter(nz).length) / Math.max(1, so.length), 1), ...row(list.map((x) => x.netR)) };
}

// one real explanation per loss cause
S.examples = {};
for (const x of losses) if (!S.examples[x.rep.cause]) S.examples[x.rep.cause] = { trade: `${x.sym} ${x.rep.side} ${x.rep.date} ${x.rep.entryClock}`, netR: R(x.netR), lines: x.rep.explain };

// Chart-ready sample trades (one per loss cause + one winner) so /autopsy can draw real replayed examples. Labelled as simulation there.
const dayChart = (c, rep) => {
  const day = c.filter((b) => b.date === rep.date);
  let pv = 0, vv = 0;
  const vwap = day.map((b) => { pv += ((b.high + b.low + b.close) / 3) * b.volume; vv += b.volume; return vv > 0 ? +(pv / vv).toFixed(2) : null; });
  const clocks = day.map((b) => b.clock);
  const ei = Math.max(0, clocks.findIndex((x) => x >= rep.entryClock));
  let xi = clocks.length - 1; for (let i = 0; i < clocks.length; i++) if (clocks[i] <= rep.exitClock) xi = i;
  return { bars: day.map((b) => [b.clock, b.open, b.high, b.low, b.close]), vwap, entryIdx: ei, exitIdx: Math.max(ei, xi) };
};
const pick = [];
const seen = new Set();
for (const x of base) {
  const key = x.rep.outcome === "WIN" ? "WIN" : x.rep.cause;
  if (seen.has(key)) continue;
  if (x.rep.date < dates[Math.floor(dates.length * 0.5)]) continue; // take examples from the later part of the history
  seen.add(key);
  pick.push({ ...x.rep, source: "simulation replay (not a journal trade)", levels: { entry: x.rec.entry, stop: x.rec.initialSl, t1: x.rec.target1, exit: x.rec.exitPrice }, exitReason: x.why, netR: R(x.netR), chart: dayChart(x.c, x.rep) });
}
fs.writeFileSync("analysis/autopsy_samples.json", JSON.stringify(pick));
fs.writeFileSync("analysis/autopsy_summary.json", JSON.stringify(S, null, 2));

// ---------------- print ----------------
const P = (t, o) => { console.log(`\n${t}`); for (const [k, v] of Object.entries(o)) console.log("  " + k.padEnd(30), typeof v.n === "number" && "avgNetR" in v ? fmtRow(v) : JSON.stringify(v)); };
console.log(`AUTOPSY BATCH  ${S.generatedFor}  (${((Date.now() - t0) / 1000).toFixed(0)}s)  split ${cut}`);
console.log("Overall (net of costs):", "ALL", fmtRow(S.overall.all), "| TRAIN", fmtRow(S.overall.train), "| TEST", fmtRow(S.overall.test));
console.log(`\nLosses: ${S.losses.n} (${S.losses.shareOfTrades}% of trades). Cause shares:`);
for (const [k, v] of Object.entries(S.losses.byCause)) console.log(`  ${k.padEnd(14)} ${String(v.n).padStart(5)}  ${String(v.pct).padStart(5)}%  avg net ${v.avgNetR}R`);
P("By time of day", S.byTimeOfDay); P("By VWAP side at entry", S.byVwapSide); P("By side", S.bySide); P("By regime", S.byRegime);
P("By distance from VWAP", S.byLateEntry); P("By pattern at entry", S.byPattern); P("By exit reason", S.byExitReason);
console.log("\nMFE (best move before the trade ended), count of trades"); console.log("  all   ", JSON.stringify(S.mfe.allTrades)); console.log("  losers", JSON.stringify(S.mfe.losingTrades));
console.log(`  losers that reached >=0.5R: ${S.mfe.lossesThatReachedHalfR}% | >=1R: ${S.mfe.lossesThatReached1R}% | T1 distance: ${S.mfe.lossesWhereT1WasReachable}% | avg R given back: ${S.mfe.avgGaveBackRLosses}`);
console.log("\nStop width (same entry rule, risk fixed Rs 500 so wider stop = smaller size)");
for (const [k, v] of Object.entries(S.stopWidth)) console.log(`  ${k.padEnd(8)} stops ${String(v.stopRatePct).padStart(5)}% of trades, noise-stops ${String(v.noiseStopPctOfStops).padStart(5)}% of stops | ${fmtRow(v)}`);
console.log("\nOne example per loss cause:");
for (const [k, v] of Object.entries(S.examples)) { console.log(`\n[${k}] ${v.trade} net ${v.netR}R`); v.lines.forEach((l) => console.log("   " + l)); }
console.log("\nWritten: analysis/autopsy_summary.json");
