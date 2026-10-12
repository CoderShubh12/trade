// scripts/daily/engine.mjs
// Daily-candle portfolio backtester (long-only, delivery trades).
// Rules of honesty:
//  - A signal is decided on a day's CLOSE and filled at the NEXT day's OPEN
//    (plus slippage). Nothing sees the future.
//  - Delivery charges and slippage are always charged.
//  - Results are compared with simply owning the Nifty.

export const DAILY_CONFIG = {
  capital: 1000000, // Rs 10 lakh in total, split into equal slots (not compounded)
  maxPositions: 10,
  slippagePercent: 0.1, // per side, against you (mid-cap opens can be wide)
  warmupBars: 200, // need 200 days for the 200-day average
  inSampleShare: 0.7,
  verdict: { minTrades: 100, minOutOfSampleTrades: 30, minProfitFactor: 1.3, minExpectancyPct: 0 },
};

// Delivery charges (Rs). Assumptions, compare with your own contract note.
export const DAILY_COSTS = {
  brokerageFlat: 20, brokeragePercent: 0.1, brokerageMin: 5, // lower of Rs 20 or 0.1%, per order
  sttPercent: 0.1, // delivery: BOTH buy and sell
  exchangeTxnPercent: 0.00297,
  sebiPerCrore: 10,
  stampBuyPercent: 0.015,
  dpChargePerSell: 18, // depository charge per scrip sold (about Rs 15.34 + GST)
  gstPercent: 18,
};

export function deliveryCharges(qty, buyPrice, sellPrice, C = DAILY_COSTS) {
  const buy = qty * buyPrice;
  const sell = qty * sellPrice;
  const brok = (t) => Math.max(C.brokerageMin, Math.min(C.brokerageFlat, (C.brokeragePercent / 100) * t));
  const brokerage = brok(buy) + brok(sell);
  const stt = (C.sttPercent / 100) * (buy + sell);
  const exch = (C.exchangeTxnPercent / 100) * (buy + sell);
  const sebi = (C.sebiPerCrore / 1e7) * (buy + sell);
  const stamp = (C.stampBuyPercent / 100) * buy;
  const gst = (C.gstPercent / 100) * (brokerage + exch + sebi);
  return brokerage + stt + exch + sebi + stamp + gst + C.dpChargePerSell;
}

// ---------------- indicators (all arrays line up with the candles) -----------
const sma = (a, n) => a.map((_, i) => (i + 1 < n ? null : a.slice(i + 1 - n, i + 1).reduce((x, y) => x + y, 0) / n));
// highest / lowest of the PRIOR n bars (the current bar is NOT included)
const priorMax = (a, n) => a.map((_, i) => (i < n ? null : Math.max(...a.slice(i - n, i))));
const priorMin = (a, n) => a.map((_, i) => (i < n ? null : Math.min(...a.slice(i - n, i))));
function rsi(close, n = 2) {
  const out = new Array(close.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i < close.length; i++) {
    const ch = close[i] - close[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { ag += g / n; al += l / n; }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
    if (i >= n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export function prepare(candles) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  return {
    candles,
    dateIdx: new Map(candles.map((c, i) => [c.date, i])),
    close,
    sma200: sma(close, 200),
    sma5: sma(close, 5),
    hh55: priorMax(high, 55),
    ll20: priorMin(low, 20),
    hh20: priorMax(high, 20),
    ll10: priorMin(low, 10),
    rsi2: rsi(close, 2),
    ret126: close.map((c, i) => (i < 126 ? null : c / close[i - 126] - 1)),
  };
}

// ---------------- strategies -------------------------------------------------
// entry(P,i) -> score (higher = better) or null. exit(P,i,held) -> true to exit.
// All of them only look at bars up to index i (today's close).
export const STRATEGIES = {
  trend55: {
    name: "Trend breakout: buy 55-day high (above 200-day avg), exit on 20-day low",
    entry: (P, i) => (P.hh55[i] && P.sma200[i] && P.close[i] > P.hh55[i] && P.close[i] > P.sma200[i] ? P.ret126[i] ?? 0 : null),
    exit: (P, i) => P.ll20[i] !== null && P.close[i] < P.ll20[i],
  },
  trend20: {
    name: "Faster breakout: buy 20-day high (above 200-day avg), exit on 10-day low",
    entry: (P, i) => (P.hh20[i] && P.sma200[i] && P.close[i] > P.hh20[i] && P.close[i] > P.sma200[i] ? P.ret126[i] ?? 0 : null),
    exit: (P, i) => P.ll10[i] !== null && P.close[i] < P.ll10[i],
  },
  pullback: {
    name: "Pullback: buy a sharp dip (RSI2 < 10) in an uptrend, sell above 5-day avg or after 10 days",
    entry: (P, i) => (P.sma200[i] && P.rsi2[i] !== null && P.close[i] > P.sma200[i] && P.rsi2[i] < 10 ? 100 - P.rsi2[i] : null),
    exit: (P, i, held) => (P.sma5[i] !== null && P.close[i] > P.sma5[i]) || held.days >= 10,
  },
  momentum: {
    name: "Momentum rotation: monthly, hold the 10 strongest 6-month stocks that are above the 200-day avg",
    monthly: true,
    entry: (P, i) => (P.sma200[i] && P.ret126[i] !== null && P.ret126[i] > 0 && P.close[i] > P.sma200[i] ? P.ret126[i] : null),
    exit: () => false, // handled by the monthly ranking
  },
};

// ---------------- portfolio simulation --------------------------------------
export function simulate(strategyKey, prepared, cfg = DAILY_CONFIG) {
  const S = STRATEGIES[strategyKey];
  const syms = Object.keys(prepared);
  const dates = [...new Set(syms.flatMap((s) => prepared[s].candles.map((c) => c.date)))].sort();
  const slot = cfg.capital / cfg.maxPositions;
  const slip = cfg.slippagePercent / 100;

  const held = {}; // sym -> { qty, entryFill, entryDate, days, entryIdxDate }
  let pendingExit = new Set();
  let pendingEntry = []; // symbols to buy at next open
  const trades = [];
  const equity = []; // { date, value }
  let realized = 0;

  const openPx = (s, d) => { const P = prepared[s]; const i = P.dateIdx.get(d); return i === undefined ? null : P.candles[i].open; };

  for (let t = 0; t < dates.length; t++) {
    const d = dates[t];

    // 1) execute yesterday's decisions at today's open (exits first)
    for (const s of [...pendingExit]) {
      const px = openPx(s, d);
      if (px === null || !held[s]) continue;
      const fill = px * (1 - slip);
      const h = held[s];
      const gross = (fill - h.entryFill) * h.qty;
      const charges = deliveryCharges(h.qty, h.entryFill, fill);
      const net = gross - charges;
      realized += net;
      trades.push({ symbol: s, entryDate: h.entryDate, exitDate: d, entryPrice: h.entryFill, exitPrice: fill, qty: h.qty, grossPnl: gross, costs: charges, netPnl: net, retPct: (net / (h.entryFill * h.qty)) * 100, holdDays: h.days });
      delete held[s];
      pendingExit.delete(s);
    }
    for (const s of pendingEntry) {
      if (held[s] || Object.keys(held).length >= cfg.maxPositions) continue;
      const px = openPx(s, d);
      if (px === null) continue;
      const fill = px * (1 + slip);
      const qty = Math.floor(slot / fill);
      if (qty < 1) continue;
      held[s] = { qty, entryFill: fill, entryDate: d, days: 0 };
    }
    pendingEntry = [];

    // 2) mark to market at today's close, count holding days
    let unreal = 0;
    for (const s of Object.keys(held)) {
      const P = prepared[s];
      const i = P.dateIdx.get(d);
      if (i === undefined) continue;
      held[s].days++;
      unreal += (P.close[i] - held[s].entryFill) * held[s].qty;
    }
    equity.push({ date: d, value: cfg.capital + realized + unreal });

    // 3) decide for tomorrow, using only data up to today's close
    const isLast = t === dates.length - 1;
    if (isLast) {
      for (const s of Object.keys(held)) pendingExit.add(s); // closed in the report as "still open"
      break;
    }
    const nextMonth = dates[t + 1].slice(0, 7) !== d.slice(0, 7);

    if (S.monthly) {
      if (nextMonth) {
        const ranked = syms
          .map((s) => { const P = prepared[s]; const i = P.dateIdx.get(d); return i === undefined || i < cfg.warmupBars ? null : { s, sc: S.entry(P, i) }; })
          .filter((x) => x && x.sc !== null)
          .sort((a, b) => b.sc - a.sc)
          .slice(0, cfg.maxPositions);
        const target = new Set(ranked.map((x) => x.s));
        for (const s of Object.keys(held)) if (!target.has(s)) pendingExit.add(s);
        pendingEntry = ranked.map((x) => x.s).filter((s) => !held[s]);
      }
      continue;
    }

    for (const s of Object.keys(held)) {
      const P = prepared[s];
      const i = P.dateIdx.get(d);
      if (i !== undefined && S.exit(P, i, held[s])) pendingExit.add(s);
    }
    const freeSlots = cfg.maxPositions - Object.keys(held).length + [...pendingExit].filter((s) => held[s]).length;
    const cands = [];
    for (const s of syms) {
      if (held[s]) continue;
      const P = prepared[s];
      const i = P.dateIdx.get(d);
      if (i === undefined || i < cfg.warmupBars) continue;
      const sc = S.entry(P, i);
      if (sc !== null) cands.push({ s, sc });
    }
    cands.sort((a, b) => b.sc - a.sc);
    pendingEntry = cands.slice(0, Math.max(0, freeSlots)).map((x) => x.s);
  }

  // positions still open at the end: valued at the last close, no exit cost counted
  const stillOpen = Object.keys(held);
  return { trades, equity, stillOpen, dates };
}

// ---------------- metrics ----------------------------------------------------
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r2 = (n) => (Number.isFinite(n) ? Number(n.toFixed(2)) : null);

export function summarize(trades) {
  const n = trades.length;
  if (!n) return { trades: 0 };
  const wins = trades.filter((t) => t.netPnl > 0);
  const gp = sum(wins.map((t) => t.netPnl));
  const gl = Math.abs(sum(trades.filter((t) => t.netPnl <= 0).map((t) => t.netPnl)));
  return {
    trades: n,
    winRatePct: r2((wins.length / n) * 100),
    netPnl: r2(sum(trades.map((t) => t.netPnl))),
    costs: r2(sum(trades.map((t) => t.costs))),
    avgRetPct: r2(sum(trades.map((t) => t.retPct)) / n),
    profitFactor: gl > 0 ? r2(gp / gl) : null,
    avgHoldDays: r2(sum(trades.map((t) => t.holdDays)) / n),
  };
}

export function curveStats(equity) {
  if (equity.length < 2) return {};
  const first = equity[0].value, last = equity[equity.length - 1].value;
  const years = (new Date(equity[equity.length - 1].date) - new Date(equity[0].date)) / (365.25 * 86400000);
  let peak = first, dd = 0;
  for (const e of equity) { peak = Math.max(peak, e.value); dd = Math.max(dd, (peak - e.value) / peak); }
  return { totalReturnPct: r2((last / first - 1) * 100), cagrPct: years > 0 ? r2((Math.pow(last / first, 1 / years) - 1) * 100) : null, maxDrawdownPct: r2(dd * 100), years: r2(years) };
}

// Buy-and-hold of an index/stock series over the same dates
export function buyHold(candles, fromDate, toDate) {
  const rows = candles.filter((c) => c.date >= fromDate && c.date <= toDate);
  if (rows.length < 2) return null;
  const eq = rows.map((c) => ({ date: c.date, value: c.close }));
  return curveStats(eq);
}

export function verdict(overall, oos, cfg = DAILY_CONFIG) {
  const v = cfg.verdict;
  const reasons = [];
  if (overall.trades < v.minTrades) reasons.push(`only ${overall.trades} trades (need ${v.minTrades})`);
  if (!(overall.avgRetPct > v.minExpectancyPct)) reasons.push(`average result per trade is ${overall.avgRetPct}% after costs (must be above 0)`);
  if (!(overall.profitFactor >= v.minProfitFactor)) reasons.push(`profit factor ${overall.profitFactor} is below ${v.minProfitFactor}`);
  if (!oos.trades || oos.trades < v.minOutOfSampleTrades) reasons.push(`only ${oos.trades || 0} out-of-sample trades (need ${v.minOutOfSampleTrades})`);
  else {
    if (!(oos.avgRetPct > v.minExpectancyPct)) reasons.push(`out-of-sample average is ${oos.avgRetPct}% per trade (must be above 0)`);
    if (!(oos.profitFactor >= v.minProfitFactor)) reasons.push(`out-of-sample profit factor ${oos.profitFactor} is below ${v.minProfitFactor}`);
  }
  return { pass: reasons.length === 0, reasons };
}
