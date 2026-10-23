// lib/niftyReversal.js - causal (bar-close) reversal detector for the Nifty 5m chart. UNVALIDATED heads-up tool, not an entry signal.
// Bullish when (A) price fell >= 0.35% from the 24-bar high to the lowest low of the last 8 bars, and at least 2 of:
//  (B) reversal candle after the low: close above the previous bar's high, or a hammer / bullish engulfing at the low
//  (C) close back above EMA9   (D) RSI(14) turning up from below 35 within the last 6 bars. Bearish is the mirror.
// Existing replay (analysis/reversal_replay.mjs) found the index did NOT continue after such alerts.
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
function rsi(cl, n = 14) { const o = cl.map(() => 50); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return o; }
export function niftyReversals(bars, { minMovePct = 0.35, cooldown = 6, fwd = 6 } = {}) {
  if (!bars || bars.length < 30) return [];
  const cl = bars.map((b) => b.close), e9 = ema(cl, 9), r = rsi(cl, 14), ev = [], last = { UP: -99, DOWN: -99 };
  for (let i = 26; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    if (b.clock < "09:45") continue;
    const win = bars.slice(i - 24, i + 1), recent = bars.slice(i - 8, i + 1);
    const hi = Math.max(...win.map((x) => x.high)), lo = Math.min(...win.map((x) => x.low));
    const rLo = Math.min(...recent.map((x) => x.low)), rHi = Math.max(...recent.map((x) => x.high));
    const body = Math.abs(b.close - b.open) || 1e-9;
    for (const dir of ["UP", "DOWN"]) {
      if (i - last[dir] < cooldown) continue;
      const up = dir === "UP";
      const move = up ? ((hi - rLo) / hi) * 100 : ((rHi - lo) / lo) * 100;
      if (move < minMovePct) continue;
      const ext = up ? rLo : rHi;
      const idxFromEnd = recent.length - 1 - recent.map((x) => (up ? x.low : x.high)).lastIndexOf(ext);
      if (idxFromEnd < 1 || idxFromEnd > 6) continue; // extreme must be 1-6 bars old
      const B = up ? (b.close > p.high || (Math.min(b.open, b.close) - b.low >= 2 * body && b.close > b.open) || (b.close > b.open && b.close >= p.open && b.open <= p.close && p.close < p.open))
                   : (b.close < p.low || (b.high - Math.max(b.open, b.close) >= 2 * body && b.close < b.open) || (b.close < b.open && b.close <= p.open && b.open >= p.close && p.close > p.open));
      const C = up ? b.close > e9[i] : b.close < e9[i];
      const rs = r.slice(i - 6, i + 1), D = up ? Math.min(...rs) < 35 && r[i] > r[i - 1] : Math.max(...rs) > 65 && r[i] < r[i - 1];
      const met = [B && "reversal candle", C && (up ? "back above EMA9" : "back below EMA9"), D && "RSI turning"].filter(Boolean);
      if (met.length < 2) continue;
      last[dir] = i;
      const f = bars[i + fwd];
      ev.push({ i, key: `${b.date} ${b.clock}`, dir, price: b.close, extreme: ext, movePct: +move.toFixed(2), met, score: met.length, afterPct: f && f.date === b.date ? +(((f.close - b.close) / b.close) * 100 * (up ? 1 : -1)).toFixed(2) : null });
    }
  }
  return ev;
}
