// lib/costs.js - approximate Indian NSE equity INTRADAY (MIS) round-trip costs. Rates are approximations (check your broker's contract note):
// brokerage min(Rs20, 0.03%) per leg, STT 0.025% on sell, exchange 0.00297%/leg, SEBI 0.0001%/leg, stamp 0.003% on buy, GST 18% on (brokerage+exchange+SEBI).
export function roundTripCost(price, qty, side = "BUY") {
  const buyV = price * qty, sellV = price * qty;
  const brok = 2 * Math.min(20, 0.0003 * buyV);
  const stt = 0.00025 * sellV, exch = 0.0000297 * (buyV + sellV), sebi = 0.000001 * (buyV + sellV), stamp = 0.00003 * buyV;
  const gst = 0.18 * (brok + exch + sebi);
  return +(brok + stt + exch + sebi + stamp + gst).toFixed(2);
}
// qty so that (entry-stop)*qty = risk amount, capped by capital*leverage / price
export function positionSize(capital, riskPct, entry, stop, leverage = 1) {
  const risk = capital * (riskPct / 100), d = Math.abs(entry - stop);
  if (!(d > 0) || !(entry > 0)) return 0;
  return Math.max(0, Math.floor(Math.min(risk / d, (capital * leverage) / entry)));
}
