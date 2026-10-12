// scripts/backtest/metrics.mjs
// Turns a list of trades into the numbers that matter.

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

export function summarize(trades, config, tradingDates = []) {
  const n = trades.length;
  if (n === 0) {
    return { trades: 0 };
  }
  const nets = trades.map((t) => t.netPnl);
  const wins = nets.filter((x) => x > 0);
  const losses = nets.filter((x) => x <= 0);
  const grossProfit = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const gross = sum(trades.map((t) => t.grossPnl));
  const grossWins = sum(trades.filter((t) => t.grossPnl > 0).map((t) => t.grossPnl));
  const grossLosses = Math.abs(sum(trades.filter((t) => t.grossPnl <= 0).map((t) => t.grossPnl)));

  // ---- Drawdown on the running net P&L (trades in exit order)
  const byExit = [...trades].sort((a, b) => a.exitMs - b.exitMs);
  let run = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of byExit) {
    run += t.netPnl;
    peak = Math.max(peak, run);
    maxDd = Math.max(maxDd, peak - run);
  }

  // ---- Sharpe from daily P&L (days without trades count as 0)
  const dailyPnl = new Map();
  tradingDates.forEach((d) => dailyPnl.set(d, 0));
  trades.forEach((t) => dailyPnl.set(t.date, (dailyPnl.get(t.date) || 0) + t.netPnl));
  const daily = [...dailyPnl.values()].map((p) => p / config.capital);
  const mean = sum(daily) / daily.length;
  const variance = sum(daily.map((d) => (d - mean) ** 2)) / Math.max(1, daily.length - 1);
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : null;

  const net = sum(nets);
  return {
    trades: n,
    winRatePct: round((wins.length / n) * 100, 1),
    grossPnl: round(gross),
    costs: round(sum(trades.map((t) => t.costs))),
    netPnl: round(net),
    avgWin: round(wins.length ? grossProfit / wins.length : 0),
    avgLoss: round(losses.length ? -grossLoss / losses.length : 0),
    expectancyRs: round(net / n),
    expectancyR: round(sum(trades.map((t) => t.rMultiple)) / n),
    profitFactorNet: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    profitFactorGross: grossLosses > 0 ? round(grossWins / grossLosses) : null,
    maxDrawdownRs: round(maxDd),
    maxDrawdownPct: round((maxDd / config.capital) * 100, 1),
    sharpeAnnualised: round(sharpe),
    avgHoldMinutes: round(sum(trades.map((t) => t.holdMinutes)) / n, 1),
  };
}

// Group trades by any key and summarize each group
export function groupSummary(trades, keyFn, config) {
  const groups = new Map();
  trades.forEach((t) => {
    const k = keyFn(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  return [...groups.entries()]
    .map(([key, list]) => ({ key, ...summarize(list, config) }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

// First part of the days = in-sample (what you could tune on).
// Last part = out-of-sample (the honest test).
export function splitInOutSample(trades, allDates, config) {
  const dates = [...new Set(allDates)].sort();
  const cut = Math.floor(dates.length * config.inSampleShare);
  const inDates = new Set(dates.slice(0, cut));
  return {
    inSampleDates: [dates[0], dates[Math.max(0, cut - 1)]],
    outSampleDates: [dates[cut], dates[dates.length - 1]],
    inSample: trades.filter((t) => inDates.has(t.date)),
    outSample: trades.filter((t) => !inDates.has(t.date)),
  };
}

// Plain verdict. PASS only when every test passes, otherwise it says why not.
export function verdict(overall, outSample, config) {
  const v = config.verdict;
  const reasons = [];
  if (overall.trades < v.minTrades) reasons.push(`only ${overall.trades} trades (need at least ${v.minTrades})`);
  if ((outSample.trades || 0) < v.minOutOfSampleTrades) reasons.push(`only ${outSample.trades || 0} out-of-sample trades (need at least ${v.minOutOfSampleTrades})`);
  if ((overall.expectancyRs ?? -1) <= v.minExpectancyRs) reasons.push(`average net result per trade is Rs ${overall.expectancyRs} (must be above Rs ${v.minExpectancyRs})`);
  if ((overall.profitFactorNet ?? 0) < v.minProfitFactor) reasons.push(`net profit factor ${overall.profitFactorNet} is below ${v.minProfitFactor}`);
  if (outSample.trades && (outSample.expectancyRs ?? -1) <= v.minExpectancyRs) reasons.push(`out-of-sample average is Rs ${outSample.expectancyRs} per trade (must be above Rs ${v.minExpectancyRs})`);
  if (outSample.trades && (outSample.profitFactorNet ?? 0) < v.minProfitFactor) reasons.push(`out-of-sample profit factor ${outSample.profitFactorNet} is below ${v.minProfitFactor}`);
  return reasons.length === 0
    ? { pass: true, reasons: ["All tests passed on this data. This is still history, not a promise: confirm with paper trading."] }
    : { pass: false, reasons };
}
