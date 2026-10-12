// lib/paperStats.js
// Turns paper-trade journal rows into REAL rupee results: sized like the app's risk
// engine, with slippage and full intraday charges (same rates as scripts/backtest/config.mjs).
import { calculatePositionSize } from "./riskEngine.js";

const C = { flat: 20, pct: 0.1, min: 5, stt: 0.025, exch: 0.0030699, sebiCr: 10, ipft: 0.0000001, stamp: 0.003, gst: 18 };
export const PAPER = { capital: 100000, riskPct: 0.5, leverage: 5, slipPct: 0.03 };

const brok = (t) => Math.max(C.min, Math.min(C.flat, (C.pct / 100) * t));
export function charges(qty, buy, sell) {
  const b = qty * buy, s = qty * sell, tot = b + s;
  const br = brok(b) + brok(s), ex = (C.exch / 100) * tot, sebi = (C.sebiCr / 1e7) * tot, ip = (C.ipft / 100) * tot;
  return br + (C.stt / 100) * s + ex + sebi + ip + (C.stamp / 100) * b + (C.gst / 100) * (br + ex + sebi + ip);
}

// One closed trade -> { qty, gross, cost, net }
export function netResult(t) {
  if (t.exitPrice == null || !t.entry) return null;
  const long = t.side === "BUY", sl = t.initialSl ?? t.stopLoss;
  const qty = calculatePositionSize(PAPER.capital, PAPER.riskPct, t.entry, sl ?? t.entry * (long ? 0.99 : 1.01), PAPER.leverage);
  if (!qty) return null;
  const k = PAPER.slipPct / 100;
  const en = t.entry * (1 + (long ? k : -k)), ex = t.exitPrice * (1 + (long ? -k : k));
  const gross = (long ? ex - en : en - ex) * qty;
  const cost = long ? charges(qty, en, ex) : charges(qty, ex, en);
  return { qty, gross, cost, net: gross - cost };
}

export function summarize(rows) {
  const done = rows.map(netResult).filter(Boolean);
  const n = done.length;
  if (!n) return { n: 0 };
  const w = done.filter((d) => d.net > 0), l = done.filter((d) => d.net <= 0);
  const gw = w.reduce((a, d) => a + d.net, 0), gl = -l.reduce((a, d) => a + d.net, 0);
  const net = done.reduce((a, d) => a + d.net, 0);
  return {
    n, wins: w.length, winPct: (100 * w.length) / n,
    pf: gl > 0 ? gw / gl : null, net, expectancy: net / n,
    gross: done.reduce((a, d) => a + d.gross, 0), costs: done.reduce((a, d) => a + d.cost, 0),
  };
}
