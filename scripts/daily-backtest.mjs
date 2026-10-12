// scripts/daily-backtest.mjs
// Run:  npm run daily-backtest
// Needs data/daily/*.json from  npm run history:daily
// Tests 4 fixed, well-known strategies on daily candles and compares them with
// simply owning the Nifty. Output: backtest-results/daily-<time>.md

import fs from "node:fs/promises";
import path from "node:path";
import { DAILY_CONFIG as CFG, STRATEGIES, prepare, simulate, summarize, curveStats, buyHold, verdict } from "./daily/engine.mjs";

const dir = path.resolve(process.argv[2] || "data/daily");
let files;
try {
  files = (await fs.readdir(dir)).filter((f) => f.endsWith("_1d.json"));
} catch {
  console.error(`No folder ${dir}. Run  npm run history:daily  first.`);
  process.exit(1);
}
const prepared = {};
let nifty = null;
for (const f of files) {
  const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
  if (j.meta.source !== "ANGEL_ONE_HISTORICAL") console.log(`WARNING: ${f} is not real Angel One data`);
  if (f.startsWith("NIFTY_50")) nifty = j.candles;
  else if (j.candles.length > CFG.warmupBars + 100) prepared[j.meta.symbol] = prepare(j.candles);
}
const syms = Object.keys(prepared);
if (!syms.length) { console.error("No usable stock files."); process.exit(1); }

const allDates = [...new Set(syms.flatMap((s) => prepared[s].candles.map((c) => c.date)))].sort();
const first = allDates[CFG.warmupBars] || allDates[0];
const last = allDates[allDates.length - 1];
const splitDate = allDates[Math.floor(allDates.length * CFG.inSampleShare)];
console.log(`${syms.length} stocks, ${allDates[0]} to ${last}. Split: in-sample up to ${splitDate}, out-of-sample after.`);

const f = (v) => (v === null || v === undefined ? "-" : v);
let md = `# Daily strategy test (long-only, delivery, after charges and slippage)\n\n`;
md += `Data: ${syms.length} stocks, ${allDates[0]} to ${last}. Trading starts after ${CFG.warmupBars} warm-up days (${first}). Out-of-sample = entries after ${splitDate}.\n`;
md += `Capital Rs ${CFG.capital.toLocaleString("en-IN")} in ${CFG.maxPositions} equal slots, slippage ${CFG.slippagePercent}% per side. Signals use the close, fills use the NEXT open.\n\n`;

const bhNifty = nifty ? buyHold(nifty, first, last) : null;
const bhBasket = (() => {
  const rets = syms.map((s) => buyHold(prepared[s].candles, first, last)).filter(Boolean);
  if (!rets.length) return null;
  const avg = rets.reduce((a, r) => a + r.totalReturnPct, 0) / rets.length;
  return { totalReturnPct: Number(avg.toFixed(2)) };
})();
md += `## Benchmarks (just own it, no trading)\n\n`;
md += `- Nifty 50 buy and hold: ${bhNifty ? `total ${bhNifty.totalReturnPct}%, about ${bhNifty.cagrPct}% a year, worst fall ${bhNifty.maxDrawdownPct}%` : "no Nifty file"}\n`;
md += `- Same stocks, equal weight, buy and hold: ${bhBasket ? `average total ${bhBasket.totalReturnPct}%` : "-"}\n\n`;

md += `## Strategies\n\n| Strategy | Trades | Win % | Avg % per trade | Profit factor | Total return | Per year | Worst fall | Out-of-sample trades | OOS avg % | OOS PF | Verdict |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
const detail = [];
for (const key of Object.keys(STRATEGIES)) {
  const res = simulate(key, prepared, CFG);
  const all = summarize(res.trades);
  const oosTrades = res.trades.filter((t) => t.entryDate > splitDate);
  const oos = summarize(oosTrades);
  const curve = curveStats(res.equity.filter((e) => e.date >= first));
  const v = verdict(all, oos, CFG);
  console.log(`${STRATEGIES[key].name}\n   trades ${all.trades} win ${all.winRatePct}% avg ${all.avgRetPct}% PF ${all.profitFactor} | total ${curve.totalReturnPct}% (${curve.cagrPct}%/yr, worst fall ${curve.maxDrawdownPct}%) | OOS ${oos.trades} trades avg ${oos.avgRetPct}% PF ${oos.profitFactor} -> ${v.pass ? "PASS" : "FAIL"}`);
  md += `| ${STRATEGIES[key].name} | ${f(all.trades)} | ${f(all.winRatePct)} | ${f(all.avgRetPct)} | ${f(all.profitFactor)} | ${f(curve.totalReturnPct)}% | ${f(curve.cagrPct)}% | ${f(curve.maxDrawdownPct)}% | ${f(oos.trades)} | ${f(oos.avgRetPct)} | ${f(oos.profitFactor)} | ${v.pass ? "PASS" : "FAIL"} |\n`;
  detail.push({ key, v, res });
}
md += `\n## Why each failed or passed\n\n`;
for (const d of detail) {
  md += `- **${STRATEGIES[d.key].name}**: ${d.v.pass ? "passes all checks" : d.v.reasons.join("; ")}${d.res.stillOpen.length ? ` (${d.res.stillOpen.length} position(s) still open at the end are not counted as trades)` : ""}\n`;
}
md += `\n## Read this before believing any of it\n\n`;
md += `- The stock list is today's list, so stocks that fell out of favour are missing (survivorship bias). This flatters every strategy.\n`;
md += `- Beating the Nifty matters: a strategy that makes less than just owning the Nifty, with more risk and more charges, is not worth running.\n`;
md += `- Each slot is a fixed Rs ${(CFG.capital / CFG.maxPositions).toLocaleString("en-IN")} (profits are not compounded), so a very bad strategy can show a loss bigger than the starting capital. That is a sign to throw it away, not a real account outcome.\n`;
md += `- A pass means "worth paper-trading", never "will make money". Charges are assumptions (see scripts/daily/engine.mjs), compare with your contract note.\n`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
await fs.mkdir("backtest-results", { recursive: true });
const out = path.join("backtest-results", `daily-${stamp}.md`);
await fs.writeFile(out, md);
console.log("\nSaved " + out);
