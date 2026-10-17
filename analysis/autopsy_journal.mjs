// Autopsy of every closed journal trade that has recorded 5m candles for its day (data/movers/5m, data/history).
// Run: node analysis/autopsy_journal.mjs
import fs from "fs";
import { autopsyAll } from "../lib/autopsy.js";

const J = JSON.parse(fs.readFileSync("data/paper-journal.json", "utf8")).filter((t) => t.exitPrice != null);
const load = (sym) => {
  for (const p of [`data/movers/5m/${sym}_5m.json`, `data/history/${sym}_5m.json`]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).candles || [];
  }
  return [];
};
const by = {};
for (const t of J) if (!by[t.symbol]) by[t.symbol] = load(t.symbol);
const { reports, errors, summary } = autopsyAll(J, by);
console.log(`closed journal trades: ${J.length}, autopsied: ${reports.length}, no candles: ${errors.length}`);
for (const r of reports) { console.log(`\n${r.symbol} ${r.side} ${r.date} ${r.entryClock} -> ${r.outcome} ${r.rReal}R [${r.cause}]`); r.explain.forEach((l) => console.log("  " + l)); }
for (const e of errors) console.log(`skipped ${e.symbol} ${e.date}: ${e.error}`);
console.log("\nsummary", JSON.stringify(summary));
