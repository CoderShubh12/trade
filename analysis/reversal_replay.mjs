// analysis/reversal_replay.mjs   (plain node: node analysis/reversal_replay.mjs)
// Replays the reversal bot on recorded 5m index candles (NIFTY_50, BANK_NIFTY; 63 days) and measures what the index did AFTER each alert:
// forward move in the alert direction over 30 and 60 minutes, split 70/30 chronologically, compared with a same-time "any bar" baseline.
// A reversal alert is worth trusting only if the forward move is clearly positive in BOTH halves. Not a trade backtest (no costs: an index is not directly tradable).
import fs from "fs";
import { REV_CFG, newRevState, updateReversal, istDay } from "../lib/reversalBot.js";
const DIR = "data/movers/5m";
const load = (n) => JSON.parse(fs.readFileSync(`${DIR}/${n}_5m.json`, "utf8")).candles;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "-");
function run(name, cfg) {
  const c = load(name), st = newRevState(), out = [], base = [];
  for (let i = 0; i < c.length; i++) {
    const ts = (c[i].time + 300) * 1000, px = c[i].close; // bar closed at time+300s
    const a = updateReversal(st, ts, px, cfg);
    const sameDay = (k) => i + k < c.length && c[i + k].date === c[i].date;
    for (const k of [6, 12]) if (sameDay(k) && a) (a["f" + k] = (c[i + k].close - px) / px * 100 * (a.dir === "UP" ? 1 : -1));
    if (a && sameDay(6)) out.push({ ...a, date: c[i].date, clock: c[i].clock });
    if (sameDay(6)) base.push((c[i + 6].close - px) / px * 100);
  }
  return { out, base };
}
const rows = [];
for (const name of ["NIFTY_50", "BANK_NIFTY"]) {
  for (const cfg of [REV_CFG, { ...REV_CFG, minMovePct: 0.4, bouncePct: 0.15 }, { ...REV_CFG, minMovePct: 0.7, bouncePct: 0.25 }]) {
    const { out, base } = run(name, cfg);
    const dates = [...new Set(out.map((a) => a.date))].sort(), cut = dates[Math.floor(dates.length * 0.7)] || "9999";
    const A = out.filter((a) => a.date < cut), B = out.filter((a) => a.date >= cut);
    const g = (x, k) => mean(x.filter((a) => a["f" + k] != null).map((a) => a["f" + k]));
    rows.push({ name, cfg: `move>=${cfg.minMovePct}% turn>=${cfg.bouncePct}%`, n: out.length, up: out.filter((a) => a.dir === "UP").length, f30: g(out, 6), f60: g(out, 12), trainN: A.length, trainF30: g(A, 6), testN: B.length, testF30: g(B, 6), baseAbs: mean(base.map(Math.abs)) });
  }
}
console.log("REVERSAL BOT REPLAY (forward index move in the alert direction, %, no costs). f30 = 30 min later, f60 = 60 min later.\n");
for (const r of rows) console.log(`${r.name.padEnd(10)} ${r.cfg.padEnd(26)} alerts ${String(r.n).padStart(3)} (up ${r.up}) | f30 ${f(r.f30)}% f60 ${f(r.f60)}% | TRAIN n${r.trainN} f30 ${f(r.trainF30)}% | TEST n${r.testN} f30 ${f(r.testF30)}% | typical |30m move| ${f(r.baseAbs)}%`);
fs.writeFileSync("analysis/reversal_replay_summary.json", JSON.stringify({ note: "Reversal alert replay on 63 days of index 5m candles. Not a trade backtest.", rows }, null, 1));
