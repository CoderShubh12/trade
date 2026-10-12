// scripts/backtest/report.mjs
// Writes the readable report (Markdown) and the trade list (CSV).

const money = (n) => (n === null || n === undefined ? "-" : `Rs ${Number(n).toLocaleString("en-IN")}`);
const val = (n) => (n === null || n === undefined ? "-" : n);

function summaryRow(label, s) {
  if (!s || !s.trades) return `| ${label} | 0 | - | - | - | - | - | - |`;
  return `| ${label} | ${s.trades} | ${s.winRatePct}% | ${money(s.netPnl)} | ${money(s.expectancyRs)} | ${val(s.profitFactorNet)} | ${money(s.maxDrawdownRs)} (${s.maxDrawdownPct}%) | ${val(s.sharpeAnnualised)} |`;
}

function groupTable(title, rows) {
  const lines = [`### ${title}`, "", "| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |", "|---|---|---|---|---|---|"];
  rows.forEach((r) => lines.push(`| ${r.key} | ${r.trades} | ${r.winRatePct}% | ${money(r.netPnl)} | ${money(r.expectancyRs)} | ${val(r.profitFactorNet)} |`));
  return lines.join("\n") + "\n";
}

export function buildReport(r) {
  const { meta, config, overall, split, outSample, inSample, groups, verdict, dataNotes } = r;
  const L = [];
  L.push("# Backtest report", "");
  if (meta.dataSources.some((s) => s !== "ANGEL_ONE_HISTORICAL")) {
    L.push("> **WARNING: THIS RUN USED NON-REAL DATA (" + [...new Set(meta.dataSources)].join(", ") + "). Results mean nothing for real trading.**", "");
  }
  L.push(`Generated: ${meta.generatedAt}  `);
  L.push(`Stocks: ${meta.stockCount} | Days: ${meta.firstDate} to ${meta.lastDate} (${meta.dayCount} trading days) | Candles: ${config.timeframeMinutes} minute`, "");

  L.push(`## Verdict: ${verdict.pass ? "PASSES the tests below" : "DOES NOT PASS"}`, "");
  verdict.reasons.forEach((x) => L.push(`- ${x}`));
  L.push("", "A backtest only describes the past. A pass here is a reason to paper-trade, never a promise of profit.", "");

  L.push("## Results (all figures are AFTER charges and slippage)", "");
  L.push("| Period | Trades | Win rate | Net P&L | Avg per trade | Profit factor | Max drawdown | Sharpe |");
  L.push("|---|---|---|---|---|---|---|---|");
  L.push(summaryRow("All days", overall));
  L.push(summaryRow(`In-sample (${split.inSampleDates[0]} to ${split.inSampleDates[1]})`, inSample));
  L.push(summaryRow(`Out-of-sample (${split.outSampleDates[0]} to ${split.outSampleDates[1]})`, outSample));
  L.push("");
  if (overall.trades) {
    L.push(`Before charges (slippage already included) the same trades made ${money(overall.grossPnl)}; charges took ${money(overall.costs)}. Average winner ${money(overall.avgWin)}, average loser ${money(overall.avgLoss)}, average hold ${overall.avgHoldMinutes} min. Profit factor before charges: ${val(overall.profitFactorGross)}.`, "");
  }

  L.push(groupTable("By exit reason", groups.byReason));
  L.push(groupTable("By side", groups.bySide));
  L.push(groupTable("By entry hour (IST)", groups.byHour));
  L.push(groupTable("By month", groups.byMonth));
  L.push(groupTable("By stock (worst and best)", groups.byStock));

  L.push("## What was assumed", "");
  L.push(`- Starting capital ${money(config.capital)}, fixed (profits not compounded). Risk per trade ${config.riskPerTradePercent}% of capital, max leverage ${config.maxLeverage}x.`);
  L.push("- A signal appears when a candle closes. The trade is filled at the NEXT candle's open, plus slippage " + config.slippagePercent + "% per side against you. Target exits get no slippage: " + (config.slippageOnTargets ? "slippage applied to targets too" : "limit order assumption") + ".");
  L.push("- Inside a candle the worst order is assumed (the move against you happens first). Stop-loss and targets are tested on candle high/low; VWAP break, 25-minute time-out and the 3:15 PM square-off are tested on the close.");
  L.push("- Charges: Angel One style intraday equity: brokerage lower of Rs 20 or 0.1% (min Rs 5) per order, STT 0.025% on sell, exchange 0.0030699%, SEBI Rs 10/crore, stamp 0.003% on buy, GST 18%. Compare with your contract note.");
  L.push("- The entry rules are exactly the app's rules (same files). The 25-minute limit is counted from the signal candle.");
  L.push(`- Nifty filter: ${meta.niftyUsed ? "applied (Nifty history was available)" : "NOT applied (no Nifty history found)"}.`);
  L.push("", "## Known limits of this test", "");
  L.push("- **Survivorship / selection bias:** the stock list is today's list, picked by today's price bands. Stocks that fell out of favour are missing, which flatters results.");
  L.push("- **Corporate actions:** candles may not be adjusted for splits and bonuses. Days with an overnight gap above " + config.skipSessionIfGapPercent + "% are skipped as a precaution.");
  L.push("- **Trades are independent per stock:** all stocks are traded at the same time with the same capital each, so real capital use on busy days would be higher than the account size.");
  L.push("- **Fills are simulated:** real markets can have wider spreads, rejected orders and partial fills, especially in volatile moments.");
  dataNotes.forEach((x) => L.push(`- Data note: ${x}`));
  L.push("");
  return L.join("\n");
}

export function buildCsv(trades) {
  const cols = ["date", "symbol", "side", "signalTime", "entryTime", "exitTime", "score", "qty", "entryPrice", "exitPrice", "stopLoss", "target1", "target2", "reason", "grossPnl", "costs", "netPnl", "rMultiple", "holdMinutes"];
  const lines = [cols.join(",")];
  trades.forEach((t) => lines.push(cols.map((c) => t[c]).join(",")));
  return lines.join("\n") + "\n";
}
