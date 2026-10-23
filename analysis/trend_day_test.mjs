// analysis/trend_day_test.mjs - Does the FIRST HOUR (09:15-10:15 Nifty bar + breadth of 44 stocks) predict the rest of the day?
// Day flagged (causally, at 10:15) BULL if Nifty first-hour return >= r1, close in the top 30% of that bar's range and >= B of stocks closed the hour up;
// BEAR is the mirror. Outcome: equal-weight basket of all stocks, 10:15 open -> day close, in the flagged direction, minus 0.06% cost per trade.
// Also reports Nifty itself (no costs). 2 years of 60m bars, chronological 60/40 split. All 27 threshold combos are printed (no cherry picking).
import fs from "fs"; import path from "path";
const DIR = path.join(process.cwd(), "data", "movers", "60m");
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).candles;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("_60m.json"));
const nifty = files.find((f) => f.startsWith("NIFTY_50"));
if (!nifty) { console.log("NIFTY_50_60m.json missing"); process.exit(1); }
const byDay = (c) => { const m = new Map(); for (const x of c) { if (!m.has(x.date)) m.set(x.date, []); m.get(x.date).push(x); } return m; };
const N = byDay(load(nifty));
const stocks = files.filter((f) => !/^(NIFTY|BANK_NIFTY)/.test(f)).map((f) => byDay(load(f)));
const days = [...N.keys()].sort(); const split = days[Math.floor(days.length * 0.6)];
const COST = 0.0006;
const rows = [];
for (const d of days) {
  const nb = N.get(d); if (!nb || nb.length < 5 || nb[0].clock !== "09:15") continue;
  const n0 = nb[0], r1 = (n0.close - n0.open) / n0.open * 100, loc = n0.high > n0.low ? (n0.close - n0.low) / (n0.high - n0.low) : 0.5;
  const nRest = (nb[nb.length - 1].close - nb[1].open) / nb[1].open * 100;
  let up = 0, k = 0, sum = 0, m = 0;
  for (const S of stocks) { const b = S.get(d); if (!b || b.length < 5 || b[0].clock !== "09:15") continue; k++; if (b[0].close > b[0].open) up++; sum += (b[b.length - 1].close - b[1].open) / b[1].open * 100; m++; }
  if (k < 25) continue;
  rows.push({ d, r1, loc, breadth: up / k, basket: sum / m, nRest });
}
const agg = (a, f) => { const n = a.length; if (!n) return null; const v = a.map(f), mean = v.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1)); return { n, mean: +mean.toFixed(3), hit: +(v.filter((x) => x > 0).length / n * 100).toFixed(1), t: +(mean / (sd / Math.sqrt(n) || 1)).toFixed(2) }; };
console.log("days", rows.length, "uncond basket rest-of-day mean %", agg(rows, (r) => r.basket).mean, "Nifty", agg(rows, (r) => r.nRest).mean);
const res = [];
for (const r1t of [0.2, 0.4, 0.6]) for (const B of [0.6, 0.7, 0.8]) for (const h of ["basket", "nifty"]) {
  const flag = (r) => (r.r1 >= r1t && r.loc >= 0.7 && r.breadth >= B ? 1 : r.r1 <= -r1t && r.loc <= 0.3 && r.breadth <= 1 - B ? -1 : 0);
  const pick = (a) => a.filter((r) => flag(r) !== 0);
  const f = (r) => flag(r) * (h === "basket" ? r.basket - COST * 100 : r.nRest);
  const tr = agg(pick(rows.filter((r) => r.d < split)), f), te = agg(pick(rows.filter((r) => r.d >= split)), f);
  res.push({ r1t, B, target: h, train: tr, test: te });
  console.log(`r1>=${r1t}% breadth>=${B} ${h.padEnd(6)} train ${JSON.stringify(tr)} | test ${JSON.stringify(te)}`);
}
fs.writeFileSync(path.join(process.cwd(), "analysis", "trend_day_test.json"), JSON.stringify({ days: rows.length, res }, null, 1));
