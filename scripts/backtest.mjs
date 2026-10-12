// scripts/backtest.mjs
// Run:   npm run backtest
//        npm run backtest -- --symbols SBIN,ONGC --from 2026-06-01 --risk 0.5 --slippage 0.05
//
// Reads candles saved by  npm run history  (folder data/history) and replays
// them through the app's real signal engine, with charges and slippage.

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./backtest/config.mjs";
import { runBacktest } from "./backtest/engine.mjs";
import { summarize, groupSummary, splitInOutSample, verdict } from "./backtest/metrics.mjs";
import { buildReport, buildCsv } from "./backtest/report.mjs";

// ---- command line options ---------------------------------------------------
function readArgs() {
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--")) args[raw[i].slice(2)] = raw[i + 1]?.startsWith("--") || raw[i + 1] === undefined ? true : raw[++i];
  }
  return args;
}
const args = readArgs();
const config = {
  ...CONFIG,
  capital: Number(args.capital ?? CONFIG.capital),
  riskPerTradePercent: Number(args.risk ?? CONFIG.riskPerTradePercent),
  slippagePercent: Number(args.slippage ?? CONFIG.slippagePercent),
};
const dataDir = path.resolve(args.dir ?? "data/history");
const outRoot = path.resolve(args.out ?? "backtest-results");
const onlySymbols = args.symbols ? String(args.symbols).split(",").map((s) => s.trim().toUpperCase()) : null;

// ---- load candles -----------------------------------------------------------
async function loadData() {
  let files;
  try {
    files = (await fs.readdir(dataDir)).filter((f) => f.endsWith(`_${config.timeframeMinutes}m.json`));
  } catch {
    console.error(`No data folder at ${dataDir}. Run  npm run history  first.`);
    process.exit(1);
  }
  const stocks = [];
  let niftyBars = [];
  const sources = [];
  const notes = [];
  for (const f of files) {
    const file = JSON.parse(await fs.readFile(path.join(dataDir, f), "utf8"));
    let candles = file.candles || [];
    if (args.from) candles = candles.filter((c) => c.date >= args.from);
    if (args.to) candles = candles.filter((c) => c.date <= args.to);
    if (f.startsWith("NIFTY_50_")) {
      niftyBars = candles;
      continue;
    }
    if (onlySymbols && !onlySymbols.includes(String(file.meta.symbol).toUpperCase())) continue;
    sources.push(file.meta.source);
    (file.meta.warnings || []).forEach((w) => notes.push(`${file.meta.symbol}: ${w}`));
    stocks.push({ symbol: file.meta.symbol, candles });
  }
  return { stocks, niftyBars, sources, notes };
}

// ---- main -------------------------------------------------------------------
const { stocks, niftyBars, sources, notes } = await loadData();
if (stocks.length === 0) {
  console.error("No stock files found (looking for *_" + config.timeframeMinutes + "m.json). Run  npm run history  first.");
  process.exit(1);
}
console.log(`Loaded ${stocks.length} stocks${niftyBars.length ? " + Nifty" : " (no Nifty file: Nifty filter off)"}. Replaying...`);
if (sources.some((s) => s !== "ANGEL_ONE_HISTORICAL")) {
  console.log("!!! WARNING: some data is NOT real Angel One history (" + [...new Set(sources)].join(", ") + "). Do not trust the results. !!!");
}

const started = Date.now();
const result = await runBacktest({
  stocks,
  niftyBars,
  config,
  onProgress: (done, total, symbol, n) => {
    if (done % 5 === 0 || done === total) console.log(`  ${done}/${total}  ${symbol}  (${n} trades)`);
  },
});

// all trading days present in the data
const allDates = [...new Set(stocks.flatMap((s) => s.candles.map((c) => c.date)))].sort();
const tradingDates = allDates.slice(1);
const trades = result.trades;

const overall = summarize(trades, config, tradingDates);
const split = splitInOutSample(trades, tradingDates, config);
const inSample = summarize(split.inSample, config, tradingDates.filter((d) => d <= split.inSampleDates[1]));
const outSample = summarize(split.outSample, config, tradingDates.filter((d) => d >= split.outSampleDates[0]));

const byStockAll = groupSummary(trades, (t) => t.symbol, config).sort((a, b) => a.netPnl - b.netPnl);
const groups = {
  byReason: groupSummary(trades, (t) => t.reason, config),
  bySide: groupSummary(trades, (t) => t.side, config),
  byHour: groupSummary(trades, (t) => String(Math.floor(t.entryTime / 100)).padStart(2, "0") + "h", config),
  byMonth: groupSummary(trades, (t) => t.date.slice(0, 7), config),
  byStock: byStockAll.length > 10 ? [...byStockAll.slice(0, 5), ...byStockAll.slice(-5)] : byStockAll,
};

const finalVerdict = verdict(overall, outSample, config);
const meta = {
  generatedAt: new Date().toISOString(),
  stockCount: stocks.length,
  firstDate: allDates[0],
  lastDate: allDates[allDates.length - 1],
  dayCount: tradingDates.length,
  dataSources: sources,
  niftyUsed: result.niftyUsed,
};
const report = buildReport({ meta, config, overall, split, inSample, outSample, groups, verdict: finalVerdict, dataNotes: notes.slice(0, 15) });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(outRoot, stamp);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "report.md"), report);
await fs.writeFile(path.join(outDir, "trades.csv"), buildCsv(trades));
await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify({ meta, config, overall, inSample, outSample, verdict: finalVerdict, perStock: result.perStock }, null, 2));

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.  Trades: ${overall.trades}`);
if (overall.trades) {
  console.log(`Net P&L after charges: Rs ${overall.netPnl} | Avg/trade: Rs ${overall.expectancyRs} | Win rate: ${overall.winRatePct}% | Profit factor: ${overall.profitFactorNet} | Max drawdown: Rs ${overall.maxDrawdownRs}`);
}
console.log(`Verdict: ${finalVerdict.pass ? "PASSES" : "DOES NOT PASS"}`);
finalVerdict.reasons.forEach((x) => console.log("  - " + x));
console.log(`Report: ${path.join(outDir, "report.md")}`);
