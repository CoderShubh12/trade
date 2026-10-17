// Unit tests for lib/autopsy.js with hand-built 5m candle paths. Run: node analysis/autopsy_unit.mjs
import { autopsyTrade, autopsyAll, timeBucket, candleRead } from "../lib/autopsy.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const clock = (i) => { const m = 9 * 60 + 15 + i * 5; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const bar = (date, i, o, h, l, c, v = 1000) => ({ time: i, date, clock: clock(i), open: o, high: h, low: l, close: c, volume: v });
const D1 = "2026-10-13", D2 = "2026-10-14";
// build: previous day hovering at 100, then the trade day: `preLevel` until bar 14, entry bar 15 (10:30), `path` = bars from 15 on, then flat tail at the last close
function build({ preLevel = 100, path }) {
  const c = [];
  for (let i = 0; i < 75; i++) c.push(bar(D1, i, 100, 100.4, 99.6, 100));
  for (let i = 0; i < 15; i++) c.push(bar(D2, i, preLevel, preLevel + 0.4, preLevel - 0.4, preLevel));
  path.forEach((p, k) => c.push(bar(D2, 15 + k, ...p)));
  const last = path[path.length - 1][3];
  for (let i = 15 + path.length; i < 75; i++) c.push(bar(D2, i, last, last + 0.2, last - 0.2, last));
  return c;
}
const base = { id: "t", symbol: "TEST", side: "BUY", dateStr: D2, entryClock: "10:30", entry: 100, stopLoss: 99, initialSl: 99, target1: 102 };
const xc = (k) => clock(15 + k);

// 1) clean win
{
  const c = build({ path: [[100, 100.6, 99.9, 100.5], [100.5, 101.2, 100.4, 101.1], [101.1, 102.2, 101, 102.1]] });
  const r = autopsyTrade({ ...base, exitPrice: 102, exitClock: xc(2), reason: "T1_SERVER" }, c);
  ok(r.outcome === "WIN", "win outcome");
  ok(r.cause === "NONE", "win has no loss cause");
  ok(Math.abs(r.rReal - 2) < 0.01, "win r=2");
  ok(r.t1Reachable === true && r.t1HitBeforeExit === true, "t1 reachable and hit");
  ok(Math.abs(r.mfeR - 2.2) < 0.01, "mfe 2.2R");
  ok(r.explain.length >= 3 && r.explain.length <= 5, "3-5 explanation lines");
}
// 2) noise stop: wick under the stop, closes back above it, price later reaches target
{
  const c = build({ path: [[100, 100.3, 99.7, 99.9], [99.9, 100, 98.9, 99.6], [99.6, 100.8, 99.5, 100.7], [100.7, 102.5, 100.6, 102.4]] });
  const r = autopsyTrade({ ...base, exitPrice: 99, exitClock: xc(1), reason: "STOP" }, c);
  ok(r.outcome === "LOSS", "noise: loss");
  ok(r.noiseStop === true, "noise: flagged");
  ok(r.cause === "NOISE_STOP", "noise: cause " + r.cause);
  ok(r.bestAfterExitR >= 2, "noise: best after exit >= 2R " + r.bestAfterExitR);
  ok(r.t1Reachable === false, "noise: target not reachable before the stop");
}
// 3) trend against: grinds down, no recovery
{
  const c = build({ path: [[100, 100.1, 99.6, 99.7], [99.7, 99.8, 99.3, 99.4], [99.4, 99.5, 98.9, 98.8], [98.8, 98.9, 98.2, 98.3]] });
  const r = autopsyTrade({ ...base, exitPrice: 99, exitClock: xc(2), reason: "STOP" }, c);
  ok(r.outcome === "LOSS", "trend: loss");
  ok(r.noiseStop === false, "trend: not noise");
  ok(r.cause === "TREND_AGAINST", "trend: cause " + r.cause);
  ok(r.mfeR < 0.5, "trend: never worked");
}
// 4) gap through the stop
{
  const c = build({ path: [[100, 100.2, 99.8, 100], [97.5, 97.8, 97.2, 97.4], [97.4, 97.6, 97.2, 97.5]] });
  const r = autopsyTrade({ ...base, exitPrice: 97.5, exitClock: xc(1), reason: "STOP" }, c);
  ok(r.cause === "GAP", "gap: cause " + r.cause);
  ok(r.gapThrough === true, "gap: flagged");
  ok(r.rReal < -2, "gap: loss bigger than 1R " + r.rReal);
}
// 5) time decay: flat, closes small loss on the time stop
{
  const flat = [];
  for (let k = 0; k < 6; k++) flat.push([99.95, 100.2, 99.75, 99.95]);
  const c = build({ path: flat });
  const r = autopsyTrade({ ...base, exitPrice: 99.9, exitClock: xc(5), reason: "TIME_DECAY_TIMEOUT" }, c);
  ok(r.outcome === "LOSS", "decay: loss " + r.rReal);
  ok(r.cause === "TIME_DECAY", "decay: cause " + r.cause);
  ok(r.noiseStop === false, "decay: time stop is not a noise stop");
}
// 6) late entry: whole morning at 95, entry at 100 far above VWAP, then grinds down
{
  const c = build({ preLevel: 95, path: [[100, 100.1, 99.6, 99.7], [99.7, 99.8, 99.3, 99.4], [99.4, 99.5, 98.9, 98.8], [98.8, 98.9, 98.2, 98.3]] });
  const r = autopsyTrade({ ...base, exitPrice: 99, exitClock: xc(2), reason: "STOP" }, c);
  ok(r.vwapDistAtr > 1.5, "late: far above vwap " + r.vwapDistAtr);
  ok(r.cause === "LATE_ENTRY", "late: cause " + r.cause);
  ok(r.factors.includes("TREND_AGAINST"), "late: trend against still listed");
}
// 7) news risk
{
  const c = build({ path: [[100, 100.1, 99.6, 99.7], [99.7, 99.8, 99.3, 99.4], [99.4, 99.5, 98.9, 98.8], [98.8, 98.9, 98.2, 98.3]] });
  const r = autopsyTrade({ ...base, feat: { eventRisk: 0.8 }, exitPrice: 99, exitClock: xc(2), reason: "STOP" }, c);
  ok(r.cause === "NEWS_RISK", "news: cause " + r.cause);
}
// 8) SELL side mirrors BUY: the win path
{
  const c = build({ path: [[100, 100.1, 99.4, 99.5], [99.5, 99.6, 98.8, 98.9], [98.9, 99, 97.8, 97.9]] });
  const r = autopsyTrade({ ...base, side: "SELL", stopLoss: 101, initialSl: 101, target1: 98, exitPrice: 98, exitClock: xc(2), reason: "T1_SERVER" }, c);
  ok(r.outcome === "WIN" && Math.abs(r.rReal - 2) < 0.01, "sell win r=2 " + r.rReal);
  ok(r.mfeR > 2, "sell mfe " + r.mfeR);
}
// 9) gave back from the peak and exited small
{
  const c = build({ path: [[100, 101.6, 100, 101.5], [101.5, 101.6, 100.0, 100.1], [100.1, 100.3, 99.9, 100.2]] });
  const r = autopsyTrade({ ...base, exitPrice: 100.2, exitClock: xc(2), reason: "TIME_DECAY_TIMEOUT" }, c);
  ok(r.outcome === "WIN" && r.gaveBackR > 1, "gave back " + r.gaveBackR);
}
// 10) errors are returned, not thrown
ok(autopsyTrade({ ...base, side: "X" }, []).error, "bad side");
ok(autopsyTrade(base, []).error, "no candles");
ok(autopsyTrade({ ...base, dateStr: "2030-01-01" }, build({ path: [[100, 100.1, 99.9, 100]] })).error, "no candles for that date");
// 11) helpers
ok(timeBucket("09:20") === "OPEN_15M" && timeBucket("10:00") === "MORNING" && timeBucket("12:00") === "MIDDAY" && timeBucket("14:00") === "AFTERNOON" && timeBucket("15:00") === "CLOSE", "time buckets");
ok(candleRead([{ open: 10, high: 11, low: 9, close: 10.5 }, { open: 10, high: 10.1, low: 8, close: 10.05 }], 1).some((p) => p.id === "HAMMER_PIN"), "hammer");
// 12) autopsyAll summary
{
  const c = build({ path: [[100, 100.1, 99.6, 99.7], [99.7, 99.8, 99.3, 99.4], [99.4, 99.5, 98.9, 98.8], [98.8, 98.9, 98.2, 98.3]] });
  const out = autopsyAll([{ ...base, exitPrice: 99, exitClock: xc(2), reason: "STOP" }, { ...base, id: "u", symbol: "NOPE" }], { TEST: c });
  ok(out.reports.length === 1 && out.errors.length === 1, "all: one report one error");
  ok(out.summary.n === 1 && out.summary.losses === 1 && out.summary.causes.TREND_AGAINST === 1, "all: summary");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
