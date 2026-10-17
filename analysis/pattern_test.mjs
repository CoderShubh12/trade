// Out-of-sample test of every chart pattern in lib/chartPatterns.js on the recorded 5m history (data/movers/5m).
//   node analysis/pattern_test.mjs
// Rules (same conventions as the other analysis scripts): signal at bar close, fill at next open +/-0.03% slippage,
// SL 1.2 ATR, target 2.0 ATR, 25-minute time stop (5 bars), flat by 15:15, trade windows 09:30-11:30 and 13:30-14:45,
// risk Rs 500/trade, notional cap Rs 5 lakh, cost = Rs 40 + 0.035% of notional, one trade per symbol per pattern at a time.
// Chronological 70/30 split by date. Gate: n>=100, PF>=1.3, net R > 0 on BOTH halves.
// Also prints the REVERSED-direction result of the same signals: if reversed is as good as the pattern, the pattern carries no information.
import fs from "fs";
import path from "path";
import { detectChartPatterns, wilderATR } from "../lib/chartPatterns.js";

const DIR = process.argv[2] || "data/movers/5m";
const RISK = 500, SLIP = 0.0003, CAP = 500000, SLM = 1.2, TGM = 2.0, HOLD = 5;
const cost = (n) => 40 + 0.00035 * n;
const mins = (clk) => +clk.slice(0, 2) * 60 + +clk.slice(3, 5);
const inWindow = (m) => (m >= 570 && m <= 690) || (m >= 810 && m <= 885);

function sim(c, i, side, atr) {
  const e = i + 1; if (e >= c.length || c[e].date !== c[i].date) return null;
  const entry = c[e].open * (1 + SLIP * side);
  const risk = SLM * atr, stop = entry - side * risk, tgt = entry + side * TGM * atr;
  let px = null;
  for (let j = e; j < Math.min(c.length, e + HOLD) && c[j].date === c[i].date; j++) {
    const clk = mins(c[j].clock);
    if (side === 1) { if (j === e && c[j].open <= stop) { px = c[j].open; break; } if (c[j].low <= stop) { px = stop; break; } if (c[j].high >= tgt) { px = tgt; break; } }
    else { if (j === e && c[j].open >= stop) { px = c[j].open; break; } if (c[j].high >= stop) { px = stop; break; } if (c[j].low <= tgt) { px = tgt; break; } }
    if (clk >= 915 - 5 || j === e + HOLD - 1 || j + 1 >= c.length || c[j + 1].date !== c[i].date) { px = c[j].close; break; }
  }
  if (px == null) return null;
  px *= 1 - SLIP * side;
  const qty = Math.min(RISK / risk, CAP / entry);
  return { r: (side * (px - entry) * qty - cost(qty * entry)) / RISK, end: e };
}
const pf = (x) => { let w = 0, l = 0; for (const v of x) v > 0 ? (w += v) : (l -= v); return l > 0 ? w / l : w > 0 ? Infinity : 0; };
const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const st = (x) => ({ n: x.length, win: x.length ? 100 * x.filter((v) => v > 0).length / x.length : NaN, pf: pf(x), avg: mean(x) });
const f = (s) => (s.n ? `n=${String(s.n).padStart(5)} win=${s.win.toFixed(1).padStart(5)}% PF=${(Number.isFinite(s.pf) ? s.pf.toFixed(2) : "inf").padStart(5)} net/trade=${(s.avg >= 0 ? "+" : "") + s.avg.toFixed(3)}R` : "n=0");

const files = fs.readdirSync(DIR).filter((x) => x.endsWith("_5m.json"));
const sigs = []; // {id, dir, date, strength, r, rRev}
let bars = 0;
for (const file of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const c = j.candles.filter((b) => b.volume > 0);
  const busyUntil = {};                       // pattern id -> index until which that pattern's trade is open
  for (let i = 60; i < c.length - 2; i++) {
    bars++;
    const m = mins(c[i].clock) + 5;           // time the bar closed
    if (!inWindow(m)) continue;
    const res = detectChartPatterns(c.slice(Math.max(0, i - 250), i + 1));
    if (!res.length) continue;
    const atr = wilderATR(c.slice(Math.max(0, i - 250), i + 1));
    for (const p of res) {
      if ((busyUntil[p.id] ?? -1) >= i) continue;
      const a = sim(c, i, p.dir, atr); if (!a) continue;
      const b = sim(c, i, -p.dir, atr);
      busyUntil[p.id] = a.end + HOLD;
      sigs.push({ id: p.id, name: p.name, dir: p.dir, date: c[i].date, strength: p.strength, r: a.r, rRev: b ? b.r : NaN });
    }
  }
}
sigs.sort((a, b) => (a.date < b.date ? -1 : 1));
const dates = [...new Set(sigs.map((s) => s.date))].sort();
const cut = dates[Math.floor(dates.length * 0.7)];
console.log(`${files.length} stocks, ${bars} bars scanned, ${sigs.length} pattern signals, ${dates[0]} -> ${dates[dates.length - 1]}, split at ${cut}\n`);
const ids = [...new Set(sigs.map((s) => s.id))];
console.log("pattern".padEnd(20), "ALL".padEnd(58), "TEST".padEnd(58), "REVERSED(all)");
const rows = [];
for (const id of ids.concat(["__ALL__"])) {
  const s = id === "__ALL__" ? sigs : sigs.filter((x) => x.id === id);
  const tr = s.filter((x) => x.date < cut).map((x) => x.r), te = s.filter((x) => x.date >= cut).map((x) => x.r);
  const rev = s.map((x) => x.rRev).filter(Number.isFinite);
  const all = st(s.map((x) => x.r));
  const pass = all.n >= 100 && all.pf >= 1.3 && tr.length && te.length && mean(tr) > 0 && mean(te) > 0;
  rows.push([id, all, st(tr), st(te), st(rev), pass]);
  console.log((id === "__ALL__" ? "ALL PATTERNS" : id).padEnd(20), f(all).padEnd(58), f(st(te)).padEnd(58), f(st(rev)), pass ? "  <-- PASS" : "");
}
const hi = sigs.filter((s) => s.strength >= 0.6);
console.log("\nStrong signals only (strength >= 0.6):", f(st(hi.map((x) => x.r))), "| reversed:", f(st(hi.map((x) => x.rRev).filter(Number.isFinite))));
console.log(rows.some((r) => r[5]) ? "\nAt least one pattern passed the gate: re-test on a longer history before trusting it." : "\nNo pattern passed the gate (n>=100, PF>=1.3, both halves positive). Patterns stay display-only.");
