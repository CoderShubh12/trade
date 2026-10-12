// scripts/depth-tools.mjs
// Turns one Angel One REST quote row (mode FULL) into a compact order-book snapshot.
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "12-Oct-2026 10:12:38" (IST) -> epoch ms
export function parseFeedTime(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s || ""));
  if (!m || MON[m[2]] === undefined) return null;
  return Date.UTC(+m[3], MON[m[2]], +m[1], +m[4], +m[5], +m[6]) - 5.5 * 3600e3;
}

const lvl = (x) => [Number(x?.price) || 0, Number(x?.quantity) || 0, Number(x?.orders) || 0];

export function toRow(q, symbol, recvMs) {
  return {
    r: recvMs, e: parseFeedTime(q.exchFeedTime), k: String(q.symbolToken), s: symbol,
    l: Number(q.ltp), v: Number(q.tradeVolume) || 0, tb: Number(q.totBuyQuan) || 0, ts: Number(q.totSellQuan) || 0,
    b: (q.depth?.buy || []).slice(0, 5).map(lvl), a: (q.depth?.sell || []).slice(0, 5).map(lvl),
  };
}

// Reject rows whose numbers are not believable.
export function plausible(row) {
  if (!(row.l > 0) || row.b.length < 1 || row.a.length < 1) return false;
  const bb = row.b[0][0], ba = row.a[0][0];
  if (!(bb > 0 && ba > 0) || ba < bb) return false;
  return Math.abs(bb / row.l - 1) < 0.05 && Math.abs(ba / row.l - 1) < 0.05;
}
