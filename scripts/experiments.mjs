// scripts/experiments.mjs
// Run:  npm run experiments
// Tests a FIXED list of strategy variants (written before looking at results)
// on the saved history. Each variant is judged on the first 70% of days
// (in-sample) AND the last 30% (out-of-sample, never used to pick anything).
// Trying many variants on the same days can fool you, so a variant only counts
// when it also passes the out-of-sample part with enough trades.

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./backtest/config.mjs";
import { runBacktest } from "./backtest/engine.mjs";
import { summarize, splitInOutSample } from "./backtest/metrics.mjs";
import { SIGNAL_RULES } from "../lib/signalMemory.js";

const dataDir = path.resolve("data/history");
const files = (await fs.readdir(dataDir)).filter((f) => f.endsWith("_5m.json"));
const stocks = [];
let niftyBars = [];
for (const f of files) {
  const j = JSON.parse(await fs.readFile(path.join(dataDir, f), "utf8"));
  if (f.startsWith("NIFTY_50_")) niftyBars = j.candles;
  else stocks.push({ symbol: j.meta.symbol, candles: j.candles });
}
const allDates = [...new Set(stocks.flatMap((s) => s.candles.map((c) => c.date)))].sort();
const tradingDates = allDates.slice(1);

const APP = { minScore: 65, maxEntries: 3, slMult: 1.2, t1Mult: 2.0, t2Mult: 3.5, maxHoldMin: 25, vwapExit: true, niftyStrict: false, fade: false };
const V = (name, change) => ({ name, strat: { ...APP, ...change } });

// ---- the list is fixed up front -------------------------------------------
const VARIANTS = [
  V("A  App as it is today", {}),
  V("B  Only strong signals (score 80+)", { minScore: 80 }),
  V("C  Only very strong (score 90+)", { minScore: 90 }),
  V("D  Nifty must agree (strict)", { niftyStrict: true }),
  V("E  One call per stock per day", { maxEntries: 1 }),
  V("F  Hold up to 60 min, no VWAP exit", { maxHoldMin: 60, vwapExit: false }),
  V("G  Bigger winners: T2 = 5 ATR, hold 90 min, no VWAP exit", { t2Mult: 5, t1Mult: 3, maxHoldMin: 90, vwapExit: false }),
  V("H  Win-rate style: tiny target 0.4 ATR, wide stop 2.5 ATR, 60 min", { t1Mult: 0.3, t2Mult: 0.4, slMult: 2.5, maxHoldMin: 60, vwapExit: false }),
  V("I  FADE the app (trade the opposite way)", { fade: true, vwapExit: false }),
  V("J  FADE, only score 80+", { fade: true, vwapExit: false, minScore: 80 }),
  V("K  Combo: 80+, Nifty agrees, one per day", { minScore: 80, niftyStrict: true, maxEntries: 1 }),
  V("L  Combo K + bigger winners (G)", { minScore: 80, niftyStrict: true, maxEntries: 1, t2Mult: 5, t1Mult: 3, maxHoldMin: 90, vwapExit: false }),
];

const cache = new Map(); // indicator maths is shared by all variants
const rows = [];
for (const v of VARIANTS) {
  SIGNAL_RULES.maxEntriesPerStockPerDay = v.strat.maxEntries;
  const config = { ...CONFIG, cache, strategy: v.strat };
  const res = await runBacktest({ stocks, niftyBars, config });
  const t = res.trades;
  const all = summarize(t, config, tradingDates);
  const split = splitInOutSample(t, tradingDates, config);
  const ins = summarize(split.inSample, config, tradingDates);
  const oos = summarize(split.outSample, config, tradingDates);
  rows.push({ name: v.name, all, ins, oos });
  console.log(`${v.name.padEnd(62)} trades ${String(all.trades).padStart(5)} win ${String(all.winRatePct).padStart(5)}%  PFnet ${all.profitFactorNet}  avg Rs ${all.expectancyRs}  | OOS trades ${oos.trades} win ${oos.winRatePct}% PF ${oos.profitFactorNet} avg Rs ${oos.expectancyRs}`);
}

const f = (n) => (n === null || n === undefined ? "-" : n);
let md = "# Strategy experiments (after charges and slippage)\n\n";
md += `Data: ${stocks.length} stocks, ${allDates[0]} to ${allDates[allDates.length - 1]}. Variants were fixed before running.\n\n`;
md += "| Variant | Trades | Win % | PF | Avg Rs/trade | OOS trades | OOS win % | OOS PF | OOS avg Rs |\n|---|---|---|---|---|---|---|---|---|\n";
for (const r of rows) {
  md += `| ${r.name} | ${r.all.trades} | ${f(r.all.winRatePct)} | ${f(r.all.profitFactorNet)} | ${f(r.all.expectancyRs)} | ${r.oos.trades} | ${f(r.oos.winRatePct)} | ${f(r.oos.profitFactorNet)} | ${f(r.oos.expectancyRs)} |\n`;
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
await fs.mkdir("backtest-results", { recursive: true });
await fs.writeFile(path.join("backtest-results", `experiments-${stamp}.md`), md);
console.log("\nSaved backtest-results/experiments-" + stamp + ".md");
