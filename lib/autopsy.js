// lib/autopsy.js
// Trade Autopsy ("reverse tracking"): replays one finished trade bar by bar against the 5m candles and says what happened and why.
// Pure functions, no imports except chartPatterns, runs in node, the server and the browser. It only EXPLAINS a trade after the fact.
// It never places, blocks or changes a call.
//
//   autopsyTrade(trade, candles, opts?) -> report | { error }
//     trade   : { id, symbol, side, entry, stopLoss|initialSl, target1, dateStr, entryClock, exitClock, exitPrice, reason, feat? }
//     candles : 5m candles, oldest -> newest, may include earlier days (used for ATR and pattern context)
//               [{ time, date, clock, open, high, low, close, volume }]
import { detectChartPatterns, wilderATR } from "./chartPatterns.js";

const mins = (c) => (/^\d{1,2}:\d{2}/.test(String(c || "")) ? +String(c).slice(0, 2) * 60 + +String(c).slice(3, 5) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

export function timeBucket(clock) {
  const m = mins(clock);
  if (m === null) return "UNKNOWN";
  if (m < 9 * 60 + 30) return "OPEN_15M";      // 09:15-09:29
  if (m < 11 * 60 + 30) return "MORNING";      // 09:30-11:29
  if (m < 13 * 60 + 30) return "MIDDAY";       // 11:30-13:29
  if (m < 14 * 60 + 45) return "AFTERNOON";    // 13:30-14:44
  return "CLOSE";                              // 14:45+
}

// Small candle-pattern read of the signal bar (the last bar closed before the fill).
export function candleRead(c, i) {
  const b = c[i], p = c[i - 1];
  if (!b) return [];
  const out = [];
  const range = b.high - b.low, body = Math.abs(b.close - b.open);
  if (range <= 0) return out;
  const up = b.close >= b.open;
  const upper = b.high - Math.max(b.open, b.close), lower = Math.min(b.open, b.close) - b.low;
  if (body / range < 0.15) out.push({ id: "DOJI", dir: 0 });
  if (lower >= 2 * body && lower / range > 0.55) out.push({ id: "HAMMER_PIN", dir: +1 });
  if (upper >= 2 * body && upper / range > 0.55) out.push({ id: "SHOOTING_PIN", dir: -1 });
  if (p) {
    const pup = p.close >= p.open;
    if (up && !pup && b.close >= p.open && b.open <= p.close && body > Math.abs(p.close - p.open)) out.push({ id: "BULL_ENGULF", dir: +1 });
    if (!up && pup && b.close <= p.open && b.open >= p.close && body > Math.abs(p.close - p.open)) out.push({ id: "BEAR_ENGULF", dir: -1 });
    if (b.high <= p.high && b.low >= p.low) out.push({ id: "INSIDE_BAR", dir: 0 });
  }
  return out;
}

function eventRiskHigh(feat) {
  const v = feat && feat.eventRisk;
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return v >= 0.5;
  return /high|severe|major|1|true/i.test(String(v));
}

export function autopsyTrade(trade, candles, opts = {}) {
  const t = trade || {};
  const side = t.side === "BUY" ? 1 : t.side === "SELL" ? -1 : 0;
  const entry = +t.entry, sl = +(t.initialSl ?? t.stopLoss), t1 = +t.target1;
  if (!side || !(entry > 0) || !(sl > 0) || sl === entry) return { error: "trade has no usable side/entry/stop" };
  if (!Array.isArray(candles) || !candles.length) return { error: "no candles" };
  const risk = Math.abs(entry - sl);
  const t1R = Number.isFinite(t1) ? (side * (t1 - entry)) / risk : null;

  // locate the day and the entry/exit bars
  const day = candles.map((c, i) => [c, i]).filter(([c]) => c.date === t.dateStr);
  if (!day.length) return { error: `no candles for ${t.dateStr}` };
  const em = mins(t.entryClock);
  const eIdx = day.find(([c]) => mins(c.clock) >= em);
  if (!eIdx) return { error: "entry time is after the last candle of the day" };
  const iE = eIdx[1];
  const dayEnd = day[day.length - 1][1];
  const xm = mins(t.exitClock);
  let iX = dayEnd;
  if (xm !== null) { const cand = day.filter(([c]) => mins(c.clock) <= xm); if (cand.length) iX = cand[cand.length - 1][1]; }
  if (iX < iE) iX = iE;

  const exitPrice = Number.isFinite(+t.exitPrice) ? +t.exitPrice : candles[iX].close;
  const rReal = (side * (exitPrice - entry)) / risk;

  // bar-by-bar path
  let mfe = 0, mae = 0, tMfe = 0, hitT1At = null, hitStopAt = null, flips = 0, lastDir = 0, maeSteps = 0, bars = 0;
  let prevClose = entry;
  for (let i = iE; i <= iX; i++) {
    const b = candles[i];
    const fav = (side * ((side > 0 ? b.high : b.low) - entry)) / risk;
    const adv = (side * ((side > 0 ? b.low : b.high) - entry)) / risk; // negative when against us
    if (fav > mfe) { mfe = fav; tMfe = (i - iE) * 5; }
    if (adv < mae) { mae = adv; maeSteps++; }
    if (hitT1At === null && t1R !== null && fav >= t1R) hitT1At = i;
    if (hitStopAt === null && adv <= -1) hitStopAt = i;
    const d = Math.sign(b.close - prevClose);
    if (d !== 0) { if (lastDir !== 0 && d !== lastDir) flips++; lastDir = d; }
    prevClose = b.close;
    bars++;
  }
  const chopRatio = bars > 2 ? flips / (bars - 1) : 0;

  // after the exit: did the trade idea work anyway?
  let afterBest = 0, reversedWithin2 = false;
  for (let k = 1; k <= 2 && iX + k <= dayEnd; k++) {
    const c = candles[iX + k];
    if ((side * (c.close - sl)) / risk >= 0.5) reversedWithin2 = true; // closed >=0.5R back on the right side of the stop
  }
  for (let i = iX + 1; i <= dayEnd; i++) afterBest = Math.max(afterBest, (side * ((side > 0 ? candles[i].high : candles[i].low) - entry)) / risk);
  const xBar = candles[iX];
  const stopBarCloseBack = side * (xBar.close - sl) > 0; // the stop bar itself closed back on the safe side: a wick
  const why0 = String(t.reason || "");
  const exitedOnStop = rReal <= -0.9 || (/stop|(^|_)sl(_|$)/i.test(why0) && !/trail|time|decay/i.test(why0) && rReal < -0.05);
  const gapThrough = exitedOnStop && ((side * (xBar.open - sl)) / risk < -0.05 || rReal < -1.3);
  const noiseStop = exitedOnStop && !gapThrough && (stopBarCloseBack || reversedWithin2);

  // context at entry (only data known before the fill)
  const iS = iE - 1; // signal bar
  const sessionBars = day.filter(([, i]) => i < iE).map(([c]) => c);
  let pv = 0, vv = 0, dHi = -Infinity, dLo = Infinity;
  for (const c of sessionBars) { const tp = (c.high + c.low + c.close) / 3; pv += tp * (c.volume || 0); vv += c.volume || 0; dHi = Math.max(dHi, c.high); dLo = Math.min(dLo, c.low); }
  const vwap = vv > 0 ? pv / vv : null;
  const atr = wilderATR(candles.slice(Math.max(0, iE - 200), iE)) || risk / 1.2;
  const vwapDistAtr = vwap !== null ? (entry - vwap) / atr : null;
  const vwapSide = vwap === null ? "UNKNOWN" : entry >= vwap ? "ABOVE" : "BELOW";
  const withVwap = vwap === null ? null : side > 0 ? entry >= vwap : entry <= vwap;
  const fromDayHighAtr = Number.isFinite(dHi) ? (dHi - entry) / atr : null;
  const fromDayLowAtr = Number.isFinite(dLo) ? (entry - dLo) / atr : null;
  const chartPatterns = iS >= 25 ? detectChartPatterns(candles.slice(0, iE)).map((p) => ({ id: p.id, name: p.name, dir: p.dir })) : [];
  const candlePatterns = iS >= 1 ? candleRead(candles, iS) : [];
  const bucket = timeBucket(t.entryClock);
  const newsRisk = eventRiskHigh(t.feat);

  // loss classification (first rule that fits wins; the others stay in `factors`)
  const win = rReal > 0.05;
  const factors = [];
  if (gapThrough) factors.push("GAP");
  if (noiseStop) factors.push("NOISE_STOP");
  if (/time|decay|timeout/i.test(String(t.reason || ""))) factors.push("TIME_DECAY");
  if (newsRisk) factors.push("NEWS_RISK");
  if (vwapDistAtr !== null && Math.abs(vwapDistAtr) > 1.5) factors.push("LATE_ENTRY");
  const steady = mfe < 0.5 && !noiseStop && !gapThrough; // never worked, went straight against us
  if (steady && rReal < 0) factors.push("TREND_AGAINST");
  let cause = "NONE";
  if (!win) cause = factors[0] || (rReal < -0.05 ? "OTHER" : "SCRATCH");

  const explain = explainTrade({ t, side, win, rReal, mfe, mae, tMfe, t1R, hitT1At, iE, iX, cause, factors, noiseStop, gapThrough, afterBest, chopRatio, vwapDistAtr, withVwap, bucket, fromDayHighAtr, fromDayLowAtr, chartPatterns, candlePatterns, bars, exitPrice });

  return {
    id: t.id || "", symbol: t.symbol || "", side: t.side, date: t.dateStr, entryClock: t.entryClock, exitClock: t.exitClock || xBar.clock,
    outcome: win ? "WIN" : rReal < -0.05 ? "LOSS" : "SCRATCH", rReal: r2(rReal), mfeR: r2(mfe), maeR: r2(mae), timeToMfeMin: tMfe,
    barsHeld: bars, t1R: r2(t1R), t1Reachable: t1R !== null ? mfe >= t1R : null, t1HitBeforeExit: hitT1At !== null,
    gaveBackR: r2(Math.max(0, mfe - Math.max(rReal, 0))), noiseStop, gapThrough, reversedWithin2Bars: reversedWithin2, bestAfterExitR: r2(afterBest),
    chopRatio: r2(chopRatio), timeBucket: bucket, vwapSide, vwapDistAtr: r2(vwapDistAtr), tradedWithVwap: withVwap,
    fromDayHighAtr: r2(fromDayHighAtr), fromDayLowAtr: r2(fromDayLowAtr), chartPatterns, candlePatterns,
    cause, factors, explain,
  };
}

function explainTrade(x) {
  const dir = x.side > 0 ? "BUY" : "SELL";
  const where = (v, a, b) => (v === null ? "" : v < 0.5 ? a : b);
  const L = [];
  L.push(`${dir} at ${x.t.entryClock} (${x.bucket.toLowerCase().replace("_", " ")}), held ${x.bars} bars (${x.bars * 5} min), result ${x.rReal >= 0 ? "+" : ""}${r2(x.rReal)}R via ${x.t.reason || "exit"}.`);
  const ctx = [];
  if (x.withVwap !== null) ctx.push(`entry was ${x.withVwap ? "with" : "against"} VWAP (${r2(x.vwapDistAtr)} ATR away)`);
  const nearLevel = x.side > 0 ? x.fromDayHighAtr : x.fromDayLowAtr;
  if (nearLevel !== null) ctx.push(`${r2(nearLevel)} ATR from the day ${x.side > 0 ? "high" : "low"}`);
  const pats = [...x.chartPatterns.map((p) => p.name || p.id), ...x.candlePatterns.map((p) => p.id)];
  if (pats.length) ctx.push(`patterns on the signal bar: ${pats.join(", ")}`);
  L.push(`Context: ${ctx.join("; ") || "no extra context"}.`);
  L.push(`Path: best move ${r2(x.mfe)}R after ${x.tMfe} min, worst ${r2(x.mae)}R${x.t1R !== null ? `; target needed ${r2(x.t1R)}R and was ${x.hitT1At !== null ? "hit" : x.mfe >= x.t1R ? "touched" : "never reached"}` : ""}${x.chopRatio > 0.6 ? "; price was choppy" : ""}.`);
  let why;
  if (x.win) {
    const gave = x.mfe - x.rReal;
    why = gave > 0.8 ? `Won, but it gave back ${r2(gave)}R from the peak: the exit left money on the table.` : "Won and exit captured most of the move.";
  } else if (x.cause === "GAP") why = "Cause GAP: price jumped through the stop, so the loss is bigger than 1R. No stop placement avoids that.";
  else if (x.cause === "NOISE_STOP") why = `Cause NOISE STOP: the stop was touched by a wick, then price recovered${x.afterBest >= (x.t1R ?? 99) ? " and later reached the target" : ""}. The stop was probably too tight for this volatility.`;
  else if (x.cause === "TIME_DECAY") why = `Cause TIME DECAY: nothing happened fast enough (best move only ${r2(x.mfe)}R), so the time stop closed it at ${r2(x.rReal)}R.`;
  else if (x.cause === "NEWS_RISK") why = "Cause NEWS RISK: event risk was high at entry, so price may have moved on news, not on the setup.";
  else if (x.cause === "LATE_ENTRY") why = `Cause LATE ENTRY: price was already ${r2(Math.abs(x.vwapDistAtr))} ATR from VWAP at entry, so it was chasing a stretched move.`;
  else if (x.cause === "TREND_AGAINST") why = `Cause TREND AGAINST: price never gave more than ${r2(x.mfe)}R and moved steadily to the stop. The signal direction was wrong for this session.`;
  else if (x.cause === "SCRATCH") why = "Roughly break-even: costs decide the sign of this one.";
  else why = "No single cause stands out; treat as a normal losing trade.";
  if (!x.win && x.factors.length > 1) why += ` Also present: ${x.factors.slice(1).join(", ")}.`;
  L.push(why);
  return L;
}

// Run many trades. candlesBySymbol: { SYMBOL: candles[] }. Returns { reports, errors, summary }.
export function autopsyAll(trades, candlesBySymbol) {
  const reports = [], errors = [];
  for (const t of trades || []) {
    const rep = autopsyTrade(t, (candlesBySymbol || {})[t.symbol] || []);
    if (rep.error) errors.push({ id: t.id, symbol: t.symbol, date: t.dateStr, error: rep.error }); else reports.push(rep);
  }
  return { reports, errors, summary: summarize(reports) };
}

export function summarize(reports) {
  const s = { n: reports.length, wins: 0, losses: 0, scratches: 0, causes: {}, byBucket: {}, noiseStops: 0, t1ReachableLosses: 0, avgGaveBackR: 0 };
  let gb = 0;
  for (const r of reports) {
    if (r.outcome === "WIN") s.wins++; else if (r.outcome === "LOSS") s.losses++; else s.scratches++;
    if (r.outcome !== "WIN") s.causes[r.cause] = (s.causes[r.cause] || 0) + 1;
    const b = (s.byBucket[r.timeBucket] = s.byBucket[r.timeBucket] || { n: 0, netR: 0 });
    b.n++; b.netR = r2(b.netR + r.rReal);
    if (r.noiseStop) s.noiseStops++;
    if (r.outcome === "LOSS" && r.t1Reachable) s.t1ReachableLosses++;
    gb += r.gaveBackR || 0;
  }
  s.avgGaveBackR = reports.length ? r2(gb / reports.length) : 0;
  return s;
}
