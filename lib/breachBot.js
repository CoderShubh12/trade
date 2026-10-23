// lib/breachBot.js - RESEARCH ONLY. Pure functions: ORB breach state of one stock + multi-stock breadth.
// The out-of-sample backtest (analysis/breach_backtest.mjs) showed ORB breaches do NOT continue (hit ~44% vs ~52% baseline), so this
// bot reports the breach and the measured stats; it does not claim a tradable edge and never opens trades.
export function vwapSeries(bars) {
  let pv = 0, vv = 0;
  return bars.map((b) => { const tp = (b.high + b.low + b.close) / 3; pv += tp * (b.volume || 0); vv += b.volume || 0; return vv ? pv / vv : b.close; });
}
export function orbLevels(bars, n = 3) {
  if (!bars || bars.length < n) return null;
  const f = bars.slice(0, n);
  return { high: Math.max(...f.map((b) => b.high)), low: Math.min(...f.map((b) => b.low)) };
}
// state of the LAST bar vs ORB: breach = "UP" | "DOWN" | "INSIDE"; barsSince = bars since the first close outside
export function breachState(bars, n = 3) {
  const o = orbLevels(bars, n);
  if (!o || bars.length <= n) return null;
  let first = -1, dir = null;
  for (let i = n; i < bars.length; i++) {
    const c = bars[i].close;
    if (c > o.high) { first = i; dir = "UP"; break; }
    if (c < o.low) { first = i; dir = "DOWN"; break; }
  }
  const last = bars[bars.length - 1].close;
  const now = last > o.high ? "UP" : last < o.low ? "DOWN" : "INSIDE";
  return { orb: o, firstBreach: dir, firstBreachIdx: first, barsSince: first >= 0 ? bars.length - 1 - first : null, now, level: dir === "UP" ? o.high : dir === "DOWN" ? o.low : null };
}
// breadth = share of the other stocks currently above their own VWAP (0..1)
export function breadth(barsByStock) {
  let up = 0, n = 0;
  for (const bars of barsByStock) {
    if (!bars || bars.length < 3) continue;
    const v = vwapSeries(bars); n++;
    if (bars[bars.length - 1].close > v[v.length - 1]) up++;
  }
  return n ? { up, n, share: up / n } : null;
}
