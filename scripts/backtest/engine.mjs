// scripts/backtest/engine.mjs
// Replays history candle by candle through the SAME engine files the app uses
// (lib/indicators, signalEngine, tradeManager, signalMemory, riskEngine).
// Nothing here knows the future: at candle k it only sees candles up to k.

import { buildCompositeScore } from "../../lib/signalEngine.js";
import { calculateATR } from "../../lib/indicators.js";
import { evaluateTradeSetup, monitorActiveTrade } from "../../lib/tradeManager.js";
import {
  newSignalMemory,
  observeScore,
  checkSignalAllowed,
  recordEntry,
  recordExit,
} from "../../lib/signalMemory.js";
import { calculatePositionSize } from "../../lib/riskEngine.js";
import { getCandleSessionKey, getIstParts } from "../../lib/sessionUtils.js";
import { tradeCharges } from "./costs.mjs";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// For every candle: which trading day (0,1,2...) is it in, and where does each day start?
function indexSessions(candles) {
  const sessionStarts = [];
  const sessionOf = new Array(candles.length);
  let lastKey = null;
  candles.forEach((c, i) => {
    const key = getCandleSessionKey(c);
    if (key !== lastKey) {
      sessionStarts.push(i);
      lastKey = key;
    }
    sessionOf[i] = sessionStarts.length - 1;
  });
  return { sessionStarts, sessionOf };
}

// Nifty change % (vs today's open) as it was known at a given moment.
// Same math as the dashboard: Nifty 5m candles, change vs the day's first open.
export function makeNiftyLookup(niftyBars) {
  if (!niftyBars || niftyBars.length === 0) return () => null;
  const rows = [];
  let dayKey = null;
  let dayOpen = null;
  for (const b of niftyBars) {
    const key = getCandleSessionKey(b);
    if (key !== dayKey) {
      dayKey = key;
      dayOpen = b.open;
    }
    rows.push({
      closeMs: b.time * 1000 + 5 * 60 * 1000,
      pct: Number((((b.close - dayOpen) / dayOpen) * 100).toFixed(2)),
    });
  }
  return (nowMs) => {
    let lo = 0;
    let hi = rows.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].closeMs <= nowMs) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found === -1 ? null : rows[found].pct;
  };
}

function biasFromPct(pct) {
  if (pct === null) return "NEUTRAL"; // no Nifty data: filter does not block
  if (pct <= -0.2) return "BEARISH";
  if (pct >= 0.2) return "BULLISH";
  return "NEUTRAL";
}

// Apply slippage against the trader: buys fill higher, sells fill lower.
function withSlippage(price, isBuyOrder, slipPercent) {
  const slip = slipPercent / 100;
  return isBuyOrder ? price * (1 + slip) : price * (1 - slip);
}

// ---------------------------------------------------------------------------
// One candle of an open trade
// ---------------------------------------------------------------------------
// We do not know the order of prices INSIDE a candle, so we assume the worst:
// the move against the trade happens first. Only stop-loss / targets are judged
// on the candle's high and low. VWAP break, time-out and 3:15 square-off are
// judged on the candle close (like the app's own 5m logic).
function stepOpenTrade(trade, candle, vwapAtClose, nowMs, config) {
  const isBuy = trade.action === "BUY";
  const adverseFirst = isBuy ? [candle.low, candle.high] : [candle.high, candle.low];
  // VWAP exits must not fire on intra-candle extremes, so give them an
  // unreachable VWAP while we test the high/low.
  const neutralVwap = isBuy ? 0 : Infinity;

  for (const price of adverseFirst) {
    const status = monitorActiveTrade(trade, price, neutralVwap, nowMs);
    if (status?.exit) return exitDetails(status.reason, trade, candle, config);
  }
  // Experiments can switch the VWAP-break exit off (config.strategy.vwapExit === false)
  const vwapForClose = config.strategy?.vwapExit === false ? neutralVwap : vwapAtClose;
  const closeStatus = monitorActiveTrade(trade, candle.close, vwapForClose, nowMs);
  if (closeStatus?.exit) return exitDetails(closeStatus.reason, trade, candle, config);
  return null;
}

// Which price do we actually exit at, for each exit reason?
function exitDetails(reason, trade, candle, config) {
  const isBuy = trade.action === "BUY";
  let rawPrice;
  let isTarget = false;

  if (reason === "STOP_LOSS_HIT" || reason === "TRAILING_SL_HIT") {
    // stop order; if the candle opened beyond the stop we get the worse open
    rawPrice = isBuy
      ? Math.min(trade.stopLoss, candle.open)
      : Math.max(trade.stopLoss, candle.open);
  } else if (reason === "TARGET_2_HIT") {
    isTarget = true;
    rawPrice = isBuy
      ? Math.max(trade.target2, candle.open)
      : Math.min(trade.target2, candle.open);
  } else {
    // VWAP break, 25-minute time-out, 3:15 square-off: market exit at the close
    rawPrice = candle.close;
  }

  const slip = isTarget && !config.slippageOnTargets ? 0 : config.slippagePercent;
  const exitIsBuyOrder = !isBuy; // closing a BUY means selling, closing a SELL means buying
  return { reason, exitPrice: withSlippage(rawPrice, exitIsBuyOrder, slip) };
}

function finishTrade(open, exit, exitCandle) {
  const isBuy = open.action === "BUY";
  const buyPrice = isBuy ? open.entryFill : exit.exitPrice;
  const sellPrice = isBuy ? exit.exitPrice : open.entryFill;
  const direction = isBuy ? 1 : -1;
  const grossPnl = direction * (exit.exitPrice - open.entryFill) * open.qty;
  const charges = tradeCharges(open.qty, buyPrice, sellPrice);
  const netPnl = grossPnl - charges.total;
  const riskRs = open.qty * Math.abs(open.signalEntry - open.initialSl);

  const exitMs = exitCandle.time * 1000 + open.tfMinutes * 60 * 1000;
  return {
    symbol: open.symbol,
    side: open.action,
    date: open.date,
    signalTime: open.signalTimeIst,
    entryTime: open.entryTimeIst,
    exitTime: getIstParts(exitMs).hhmm,
    entryMs: open.entryMs,
    exitMs,
    score: open.score,
    qty: open.qty,
    entryPrice: round(open.entryFill),
    exitPrice: round(exit.exitPrice),
    stopLoss: round(open.initialSl),
    target1: round(open.target1),
    target2: round(open.target2),
    reason: exit.reason,
    grossPnl: round(grossPnl),
    costs: round(charges.total),
    netPnl: round(netPnl),
    rMultiple: riskRs > 0 ? round(netPnl / riskRs) : 0,
    holdMinutes: Math.round((exitMs - open.entryMs) / 60000),
  };
}

const round = (n) => Number(Number(n).toFixed(2));

// ---------------------------------------------------------------------------
// Replay one stock
// ---------------------------------------------------------------------------
export async function simulateStock({ symbol, candles, niftyLookup, config }) {
  const tf = config.timeframeMinutes;
  const trades = [];
  const stats = { signals: 0, unfilled: 0, skippedGapDays: 0, tradingDays: 0 };
  if (!candles || candles.length < 100) return { trades, stats };

  const { sessionStarts, sessionOf } = indexSessions(candles);
  const lastIndexOfSession = (s) =>
    s + 1 < sessionStarts.length ? sessionStarts[s + 1] - 1 : candles.length - 1;

  // Days with a crazy overnight gap (split / bonus / bad data) are skipped
  const skipSession = new Set();
  for (let s = 1; s < sessionStarts.length; s++) {
    const prevClose = candles[sessionStarts[s] - 1].close;
    const todayOpen = candles[sessionStarts[s]].open;
    const gap = (Math.abs(todayOpen - prevClose) / prevClose) * 100;
    if (gap > config.skipSessionIfGapPercent) {
      skipSession.add(s);
      stats.skippedGapDays++;
    }
  }

  let memory = null;
  let open = null; // trade that is running
  let pending = null; // signal waiting for the next candle's open

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const s = sessionOf[i];
    if (s === 0 || skipSession.has(s)) continue; // day 0 has no "yesterday" for CPR
    const nowMs = c.time * 1000 + tf * 60 * 1000; // moment this candle closed
    const dayKey = getCandleSessionKey(c);
    const isLastOfDay = i === lastIndexOfSession(s);
    if (sessionStarts[s] === i) stats.tradingDays++;

    // 1) A signal from the previous candle gets filled at this candle's open
    if (pending && pending.sessionIdx === s) {
      const setup = pending.setup;
      const isBuy = setup.action === "BUY";
      const fill = withSlippage(c.open, isBuy, config.slippagePercent);
      const alreadyBeyond = isBuy
        ? fill >= setup.target1 || fill <= setup.stopLoss
        : fill <= setup.target1 || fill >= setup.stopLoss;
      if (alreadyBeyond) {
        stats.unfilled++; // price jumped past the plan: a sensible trader skips
      } else {
        const qty = calculatePositionSize(
          config.capital,
          config.riskPerTradePercent,
          setup.entry,
          setup.stopLoss,
          config.maxLeverage,
        );
        open = {
          ...setup, // action, target1/2, stopLoss, maxTime, t1Reached ...
          entry: fill, // trailing-SL-to-cost uses the real fill price
          symbol,
          qty,
          entryFill: fill,
          signalEntry: setup.entry,
          initialSl: setup.initialSl,
          entryMs: c.time * 1000,
          entryTimeIst: getIstParts(c.time * 1000).hhmm,
          signalTimeIst: pending.signalTimeIst,
          date: dayKey,
          score: pending.score,
          tfMinutes: tf,
        };
      }
      pending = null;
    }

    // 2) Score on closed candles only (history = about 5 days up to this candle)
    const windowStart = sessionStarts[Math.max(0, s - (config.indicatorHistorySessions - 1))];
    const history = candles.slice(windowStart, i + 1);
    // Experiments reuse the (slow) indicator maths between variants.
    const ck = `${symbol}:${i}`;
    let basis = config.cache?.get(ck);
    if (!basis) {
      const full = buildCompositeScore(history, tf, true);
      basis = { score: full.score, ind: { latest: { vwap: full.ind?.latest?.vwap } } };
      config.cache?.set(ck, basis);
    }
    memory = observeScore(memory, basis.score, dayKey);

    // 3) Manage the running trade
    if (open) {
      const vwapAtClose = basis.ind?.latest?.vwap ?? c.close;
      let exit = stepOpenTrade(open, c, vwapAtClose, nowMs, config);
      if (!exit && isLastOfDay) {
        // Safety net: never carry a trade overnight
        const isBuy = open.action === "BUY";
        exit = {
          reason: "END_OF_DAY",
          exitPrice: withSlippage(c.close, !isBuy, config.slippagePercent),
        };
      }
      if (exit) {
        trades.push(finishTrade(open, exit, c));
        memory = recordExit(memory, nowMs);
        open = null;
      }
      continue;
    }

    // 4) Look for a new signal (not on the last candle: nothing left to fill it)
    if (isLastOfDay) continue;
    const strat = config.strategy || {};
    if (Math.abs(basis.score) < (strat.minScore ?? 65)) continue;
    if (!checkSignalAllowed(memory, nowMs).allowed) continue;

    const atr = calculateATR(history, 14);
    const bias = biasFromPct(niftyLookup(nowMs));
    // Strict Nifty filter: BUY only when Nifty is up, SELL only when it is down
    if (strat.niftyStrict) {
      if (basis.score > 0 && bias !== "BULLISH") continue;
      if (basis.score < 0 && bias !== "BEARISH") continue;
    }
    const setup = await evaluateTradeSetup(
      basis.score,
      bias,
      c,
      basis.ind?.latest?.vwap,
      atr,
      { nowMs, bypassTimeWindow: false, symbol, timeframe: String(tf) },
    );
    if (setup.action === "BUY" || setup.action === "SELL") {
      if (config.strategy) reshapeSetup(setup, atr, strat, nowMs);
      memory = recordEntry(memory, setup.action);
      stats.signals++;
      pending = {
        setup,
        score: basis.score,
        sessionIdx: s,
        signalTimeIst: getIstParts(nowMs).hhmm,
      };
    }
  }
  return { trades, stats };
}

// Experiments only: change stop / target distances, hold time, or flip the side
// ("fade" = trade AGAINST the app's signal). With no overrides the numbers are
// the app's own (SL 1.2, T1 2.0, T2 3.5 ATR, 25 minutes), so results are identical.
function reshapeSetup(setup, atr, strat, nowMs) {
  const entry = setup.entry;
  const safeAtr = Math.max(entry * 0.004, atr || entry * 0.008);
  const side = strat.fade ? (setup.action === "BUY" ? "SELL" : "BUY") : setup.action;
  const up = side === "BUY" ? 1 : -1;
  const r2 = (n) => Number(Number(n).toFixed(2));
  setup.action = side;
  setup.stopLoss = r2(entry - up * safeAtr * (strat.slMult ?? 1.2));
  setup.target1 = r2(entry + up * safeAtr * (strat.t1Mult ?? 2.0));
  setup.target2 = r2(entry + up * safeAtr * (strat.t2Mult ?? 3.5));
  setup.initialSl = setup.stopLoss;
  setup.maxTime = nowMs + (strat.maxHoldMin ?? 25) * 60 * 1000;
}

// Replay many stocks
export async function runBacktest({ stocks, niftyBars, config, onProgress }) {
  const niftyLookup = makeNiftyLookup(niftyBars);
  const allTrades = [];
  const perStock = {};
  for (let k = 0; k < stocks.length; k++) {
    const st = stocks[k];
    const { trades, stats } = await simulateStock({
      symbol: st.symbol,
      candles: st.candles,
      niftyLookup,
      config,
    });
    allTrades.push(...trades);
    perStock[st.symbol] = stats;
    onProgress?.(k + 1, stocks.length, st.symbol, trades.length);
  }
  allTrades.sort((a, b) => a.entryMs - b.entryMs);
  return { trades: allTrades, perStock, niftyUsed: niftyBars?.length > 0 };
}
