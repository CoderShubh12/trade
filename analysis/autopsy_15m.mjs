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

const BAR = Number(process.env.BAR_MIN) || 15; // candle size in minutes
const BM = BAR * 60000;
const DIR = process.argv[2] || "/tmp/m15";
const HOLD = Number(process.env.HOLD_BARS) || 2; // time stop in 5m bars (5 = the terminal's 25 min). HOLD_BARS=12 node ... tests 60 min
// What-if: VWAP_BUF_PCT=0.3 widens the VWAP-breach exit buffer from 0.05% to 0.3%; VWAP_BUF_PCT=off disables that exit. Baseline files are only written for the default settings.
const VB = process.env.VWAP_BUF_PCT === "off" ? Infinity : Number(process.env.VWAP_BUF_PCT) || 0.05;
// More what-ifs: MIN_SCORE=75 only takes calls with |score| >= 75 (terminal uses 65); TGT_SCALE=1.5 multiplies T1/T2 distances (stop unchanged).
const MIN_SCORE = Number(process.env.MIN_SCORE) || 65, TGT = Number(process.env.TGT_SCALE) || 1;
const MIN_ATRPCT = Number(process.env.MIN_ATRPCT) || 0; // MIN_ATRPCT=0.3 only trades when 14-bar ATR >= 0.3% of price (costs weigh less)
const DEFAULTS = false && HOLD === 5 && VB === 0.05 && MIN_SCORE === 65 && TGT === 1 && MIN_ATRPCT === 0;
const RISK = 500, SLIP = 0.0003, CAP = 500000, WINDOW_BARS = Math.round(375 * 5 / BAR), LOSS_COOL_MIN = 45;
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
    const h = hhmmOf(c[i].time * 1000 + BM);
    if (h < 930 || h > 1445) continue;
    const closed = c.slice(Math.max(0, i - WINDOW_BARS + 1), i + 1);
    const b = buildCompositeScore(closed, BAR, true);
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
    const now = c[i].time * 1000 + BM;
    if (now < coolUntil) continue;
    mem = observeScore(mem, s.score, c[i].date);
    if (Math.abs(s.score) < MIN_SCORE) continue;
    if (!checkSignalAllowed(mem, now).allowed) continue;
    if (s.atr === null) { s.atr = calculateATR(s.closed, 14); s.regime = detectMarketRegime(s.closed); }
    if (MIN_ATRPCT && (100 * s.atr) / c[i].close < MIN_ATRPCT) continue;
    const setup = await evaluateTradeSetup(s.score, biasAt(c[i]), c[i], s.vwap, s.atr, { nowMs: now, bypassTimeWindow: false, useGroqValidation: false, symbol: sym, timeframe: String(BAR), regime: s.regime });
    if (!setup || (setup.action !== "BUY" && setup.action !== "SELL")) continue;
    mem = recordEntry(mem, setup.action);
    const e = i + 1;
    if (e >= c.length || c[e].date !== c[i].date) continue;
    const side = setup.action === "BUY" ? 1 : -1;
    const safeAtr = Math.abs(setup.entry - setup.stopLoss) / 1.2;
    const entry = c[e].open * (1 + SLIP * side);
    const stop0 = +(entry - side * slMult * safeAtr).toFixed(2);
    const tr = { action: setup.action, entry, target1: +(entry + side * 2 * TGT * safeAtr).toFixed(2), target2: +(entry + side * 3.5 * TGT * safeAtr).toFixed(2), stopLoss: stop0, t1Reached: false, maxTime: now + HOLD * BAR * 60000 };

    // walk the bars with the app's own monitorActiveTrade
    let px = null, why = "", xi = e, vp = 0, vv = 0;
    const dayStart = (() => { let d = i; while (d > 0 && c[d - 1].date === c[i].date) d--; return d; })();
    for (let k = dayStart; k <= i; k++) { const t = (c[k].high + c[k].low + c[k].close) / 3; vp += t * c[k].volume; vv += c[k].volume; }
    for (let j = e; j < c.length && c[j].date === c[e].date; j++) {
      const b = c[j], t0 = b.time * 1000;
      const vwap0 = vv > 0 ? vp / vv : entry;
      const vwap = VB === Infinity ? (side > 0 ? 1e-6 : 1e9) : vwap0 * (1 - side * (VB - 0.05) / 100); // value handed to monitorActiveTrade so its fixed 0.05% buffer becomes VB
      const pts = side > 0 ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close];
      for (let p = 0; p < 4 && px === null; p++) {
        const st = monitorActiveTrade(tr, pts[p], vwap, p === 3 ? t0 + BM - 1000 : p === 0 ? t0 : t0 + 60000 * p);
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
    const exitMs = c[xi].time * 1000 + BM;
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

const t0b = Date.now();
const all = [];
for (const file of files) {
  const sym = file.replace("_5m.json", "");
  if (SKIP.has(sym)) continue;
  const c = load(file);
  if (c.length < 100) continue;
  const sc = scoreBars(c);
  const trades = await replay(sym, c, sc, 1.2);
  for (const t of trades) all.push({ sym, netR: t.netR, side: t.side, why: t.why, date: c[t.e].date, clock: c[t.e].clock });
}
const dates = [...new Set(all.map((x) => x.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];
const sel = (f) => all.filter(f).map((x) => x.netR);
const out = { bar: BAR, hold: HOLD, days: dates.length, range: dates[0] + " -> " + dates[dates.length - 1], split: cut,
  all: row(all.map((x) => x.netR)), train: row(sel((x) => x.date < cut)), test: row(sel((x) => x.date >= cut)),
  buy: row(sel((x) => x.side > 0)), sell: row(sel((x) => x.side < 0)) };
const by = {}; for (const x of all) (by[x.why] = by[x.why] || []).push(x.netR);
out.byExit = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, row(v)]));
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync("analysis/autopsy_" + BAR + "m_summary.json", JSON.stringify(out, null, 2));
