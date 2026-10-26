// lib/confluence.js - causal "confluence" score per 5m bar, -6..+6: VWAP side, EMA9 vs EMA21, close vs day open, ORB side (after 3 bars),
// RSI14 (>=55 / <=45), position in day range (>70% / <30%). Describes the CURRENT STATE of a stock. Our test over 152k bars found no predictive
// power (analysis/confluence_test.py): every score bucket had ~0% 30-minute forward return before costs.
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map((v) => (e = v * k + e * (1 - k))); };
export function confluence(bars) {
  if (!bars || bars.length < 20) return [];
  const cl = bars.map((b) => b.close), e9 = ema(cl, 9), e21 = ema(cl, 21);
  let ag = 0, al = 0; const rsi = cl.map((c, i) => { if (!i) return 50; const d = c - cl[i - 1]; ag = (ag * 13 + Math.max(d, 0)) / 14; al = (al * 13 + Math.max(-d, 0)) / 14; return al ? 100 - 100 / (1 + ag / al) : 100; });
  const out = []; let day = null, pv = 0, vv = 0, dh = 0, dl = 0, op = 0, oh = 0, ol = 0, di = 0;
  bars.forEach((b, i) => {
    if (b.date !== day) { day = b.date; pv = 0; vv = 0; dh = b.high; dl = b.low; op = b.open; di = 0; }
    pv += ((b.high + b.low + b.close) / 3) * (b.volume || 0); vv += b.volume || 0; dh = Math.max(dh, b.high); dl = Math.min(dl, b.low);
    if (di === 2) { oh = dh; ol = dl; }
    const vw = vv ? pv / vv : b.close, f = {};
    f["VWAP"] = Math.sign(b.close - vw); f["EMA 9/21"] = Math.sign(e9[i] - e21[i]); f["vs open"] = Math.sign(b.close - op);
    f["ORB"] = di >= 3 ? (b.close > oh ? 1 : b.close < ol ? -1 : 0) : 0; f["RSI"] = rsi[i] >= 55 ? 1 : rsi[i] <= 45 ? -1 : 0;
    const pos = dh > dl ? (b.close - dl) / (dh - dl) : 0.5; f["Day range"] = pos > 0.7 ? 1 : pos < 0.3 ? -1 : 0;
    out.push({ date: b.date, clock: b.clock, score: Object.values(f).reduce((a, x) => a + x, 0), factors: f }); di++;
  });
  return out;
}
