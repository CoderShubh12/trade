// lib/signalPoints.js - marks where simple, CAUSAL rules fired on the chart (decided at bar close, no hindsight):
//  ORB: first 5m close beyond the opening range (first 3 bars) each day
//  VWAP: close crosses VWAP with EMA9 vs EMA21 agreeing
//  HOD/LOD: close breaks the running day high/low after 10:00 on volume > 1.5x its 20-bar average
// Each point also carries what price did over the next 5 bars (for display only). These are rule triggers, NOT a profitable-signal claim:
// out-of-sample tests (analysis/strategy_search.mjs) found no tradable edge in these rules.
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
export function signalPoints(bars, { fwd = 5, gap = 6 } = {}) {
  if (!bars || bars.length < 25) return [];
  const cl = bars.map((b) => b.close), e9 = ema(cl, 9), e21 = ema(cl, 21);
  const pts = [], lastAt = { BUY: -99, SELL: -99 };
  let day = null, pv = 0, vv = 0, hi = 0, lo = 0, orbH = 0, orbL = 0, di = 0, orbDone = { BUY: false, SELL: false };
  let vwPrev = null;
  const push = (i, side, rule, why) => {
    if (i - lastAt[side] < gap) return; lastAt[side] = i;
    const b = bars[i], f = bars[i + fwd];
    const after = f && f.date === b.date ? +(((f.close - b.close) / b.close) * 100 * (side === "BUY" ? 1 : -1)).toFixed(2) : null;
    pts.push({ key: `${b.date} ${b.clock}`, side, rule, why, price: b.close, afterPct: after });
  };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.date !== day) { day = b.date; pv = 0; vv = 0; hi = b.high; lo = b.low; di = 0; orbDone = { BUY: false, SELL: false }; vwPrev = null; }
    pv += ((b.high + b.low + b.close) / 3) * (b.volume || 0); vv += b.volume || 0;
    const vw = vv ? pv / vv : b.close;
    if (di === 2) { orbH = hi; orbL = lo; }
    if (di >= 3) {
      if (b.close > orbH && !orbDone.BUY) { orbDone.BUY = true; push(i, "BUY", "ORB", "closed above the opening-range high"); }
      if (b.close < orbL && !orbDone.SELL) { orbDone.SELL = true; push(i, "SELL", "ORB", "closed below the opening-range low"); }
      if (vwPrev != null) {
        if (b.close > vw && bars[i - 1].close <= vwPrev && e9[i] > e21[i]) push(i, "BUY", "VWAP", "crossed above VWAP with EMA9 > EMA21");
        if (b.close < vw && bars[i - 1].close >= vwPrev && e9[i] < e21[i]) push(i, "SELL", "VWAP", "crossed below VWAP with EMA9 < EMA21");
      }
      if (b.clock >= "10:00") {
        let s = 0, c = 0; for (let k = Math.max(0, i - 20); k < i; k++) { s += bars[k].volume || 0; c++; }
        const hot = c && (b.volume || 0) > 1.5 * (s / c);
        if (hot && b.close > hi) push(i, "BUY", "HOD", "broke the day high on high volume");
        if (hot && b.close < lo) push(i, "SELL", "LOD", "broke the day low on high volume");
      }
    }
    vwPrev = vw; hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); di++;
  }
  return pts;
}
