// lib/signalPoints.js - marks where simple, CAUSAL rules fired on the chart (decided at bar close, no hindsight):
//  ORB: first 5m close beyond the opening range (first 3 bars) each day
//  VWAP: close crosses VWAP with EMA9 vs EMA21 agreeing
//  HOD/LOD: close breaks the running day high/low after 10:00 on volume > 1.5x its 20-bar average
// Each point also carries what price did over the next 5 bars (for display only). These are rule triggers, NOT a profitable-signal claim:
// out-of-sample tests (analysis/strategy_search.mjs) found no tradable edge in these rules.
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
// W (double bottom) / M (double top), causal: two pivot lows (highs) within 0.25% of each other, 4-25 bars apart, after a >=0.3% leg;
// fires on the first close beyond the neckline (the high / low between the two pivots), at most 12 bars after the second pivot.
function doublePoints(bars, push) {
  const piv = (i, low) => { for (let k = 1; k <= 2; k++) { if (low ? bars[i].low > bars[i - k].low || bars[i].low > bars[i + k].low : bars[i].high < bars[i - k].high || bars[i].high < bars[i + k].high) return false; } return true; };
  for (let i = 8; i < bars.length; i++) {
    const day = bars[i].date; if (bars[i].clock < "09:45") continue;
    for (const low of [true, false]) {
      // pivots confirmed (2 bars later) up to bar i-2, same day
      const pv = []; for (let j = Math.max(2, i - 30); j <= i - 2; j++) if (bars[j].date === day && piv(j, low)) pv.push(j);
      if (pv.length < 2) continue;
      const j2 = pv[pv.length - 1];
      for (let q = pv.length - 2; q >= 0; q--) {
        const j1 = pv[q], gap = j2 - j1; if (gap < 4 || gap > 25) continue;
        const a = low ? bars[j1].low : bars[j1].high, b = low ? bars[j2].low : bars[j2].high;
        if (Math.abs(a - b) / a > 0.0025) continue;
        const seg = bars.slice(j1, j2 + 1), neck = low ? Math.max(...seg.map((x) => x.high)) : Math.min(...seg.map((x) => x.low));
        const lead = bars.slice(Math.max(0, j1 - 12), j1 + 1), leg = low ? (Math.max(...lead.map((x) => x.high)) - a) / a : (a - Math.min(...lead.map((x) => x.low))) / a;
        if (leg < 0.003 || i - j2 > 12) continue;
        const c = bars[i].close, pc = bars[i - 1].close;
        if (i === j2 + 2) push(i, low ? "BUY" : "SELL", low ? "W?" : "M?", low ? `possible double bottom ${a.toFixed(2)} / ${b.toFixed(2)}: watch only, confirmation needs a close above the neckline ${neck.toFixed(2)}` : `possible double top ${a.toFixed(2)} / ${b.toFixed(2)}: watch only, confirmation needs a close below the neckline ${neck.toFixed(2)}`);
        if (low ? c > neck && pc <= neck : c < neck && pc >= neck) push(i, low ? "BUY" : "SELL", low ? "W" : "M", low ? `double bottom ${a.toFixed(2)} / ${b.toFixed(2)}, closed above the neckline ${neck.toFixed(2)}` : `double top ${a.toFixed(2)} / ${b.toFixed(2)}, closed below the neckline ${neck.toFixed(2)}`);
        break;
      }
    }
  }
}
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
  lastAt.BUY = -99; lastAt.SELL = -99;
  doublePoints(bars, push);
  pts.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return pts;
}
