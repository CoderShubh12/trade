// lib/chartPatterns.js
// Multi-bar CHART patterns on closed candles (pure functions, no imports, runs in the browser, server and plain node).
// Every pattern fires ONLY on the bar where price first closes beyond its trigger level (neckline / trendline / box edge),
// and only uses pivots that were already confirmed `K` bars earlier, so nothing looks into the future.
// Output is for display and shadow-logging. It does not change any call until analysis/pattern_test.mjs shows it earns money
// after costs on out-of-sample data.
//
//   detectChartPatterns(candles) -> [{ id, name, dir: +1|-1, strength: 0..1, trigger, invalidation, note }]
//   candles: [{ time, date, clock, open, high, low, close, volume }] oldest -> newest, LAST ONE MUST BE CLOSED.

const K = 3; // a pivot needs K bars on each side

export function wilderATR(c, period = 14) {
  if (!c || c.length < 2) return 0;
  let atr = 0;
  const n = Math.min(c.length, 200);
  const from = c.length - n;
  for (let i = from + 1; i < c.length; i++) {
    const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
    atr = i - from <= period ? atr + tr / period : (atr * (period - 1) + tr) / period;
  }
  return atr;
}

// Confirmed swing points inside [s, n-1]. A pivot at p needs p+K <= n-1 (already confirmed by closed bars).
export function swings(c, s) {
  const hi = [], lo = [], n = c.length;
  for (let p = s + K; p <= n - 1 - K; p++) {
    let isH = true, isL = true;
    for (let j = p - K; j <= p + K; j++) {
      if (j === p) continue;
      if (j < p ? c[j].high > c[p].high : c[j].high >= c[p].high) isH = false;
      if (j < p ? c[j].low < c[p].low : c[j].low <= c[p].low) isL = false;
    }
    if (isH) hi.push({ i: p, v: c[p].high });
    if (isL) lo.push({ i: p, v: c[p].low });
  }
  return { hi, lo };
}

const sessionStart = (c) => {
  const d = c[c.length - 1].date;
  let s = c.length - 1;
  while (s > 0 && c[s - 1].date === d) s--;
  return s;
};
const avgVol = (c, upto, len = 20) => {
  let t = 0, k = 0;
  for (let i = Math.max(0, upto - len); i < upto; i++) { t += c[i].volume || 0; k++; }
  return k ? t / k : 0;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function line(p1, p2) { const m = (p2.v - p1.v) / (p2.i - p1.i); return { m, at: (i) => p1.v + m * (i - p1.i) }; }

function volStrength(c, n1) {
  const av = avgVol(c, n1);
  return av > 0 ? clamp01(((c[n1].volume || 0) / av - 0.8) / 1.6) : 0.3; // 0.8x -> 0, 2.4x -> 1
}

export function detectChartPatterns(candles, opts = {}) {
  const out = [];
  const c = candles;
  const n = c.length;
  if (!c || n < 25) return out;
  const L = n - 1; // last closed bar
  const s = Math.max(sessionStart(c), L - 90);
  if (L - s < 20) return out; // need a real session sample
  const atr = wilderATR(c);
  if (!(atr > 0)) return out;
  const { hi, lo } = swings(c, s);
  const vs = volStrength(c, L);
  const close = c[L].close, prevClose = c[L - 1].close;
  const crossDown = (lvl) => close < lvl - 0.1 * atr && prevClose >= lvl - 0.1 * atr;
  const crossUp = (lvl) => close > lvl + 0.1 * atr && prevClose <= lvl + 0.1 * atr;
  const push = (id, name, dir, trigger, invalidation, quality, note) =>
    out.push({ id, name, dir, strength: +clamp01(0.5 * quality + 0.5 * vs).toFixed(2), trigger: +trigger.toFixed(2), invalidation: +invalidation.toFixed(2), note });

  // 1) DOUBLE TOP / DOUBLE BOTTOM
  if (hi.length >= 2) {
    const a = hi[hi.length - 2], b = hi[hi.length - 1];
    if (b.i - a.i >= 6 && b.i - a.i <= 60 && Math.abs(a.v - b.v) <= 0.35 * atr) {
      let neck = Infinity;
      for (let j = a.i; j <= b.i; j++) neck = Math.min(neck, c[j].low);
      if (Math.max(a.v, b.v) - neck >= 1.0 * atr && crossDown(neck)) {
        push("dbl_top", "Double Top", -1, neck, Math.max(a.v, b.v), clamp01((Math.max(a.v, b.v) - neck) / (3 * atr)), "Second test of the same high failed; neckline broken.");
      }
    }
  }
  if (lo.length >= 2) {
    const a = lo[lo.length - 2], b = lo[lo.length - 1];
    if (b.i - a.i >= 6 && b.i - a.i <= 60 && Math.abs(a.v - b.v) <= 0.35 * atr) {
      let neck = -Infinity;
      for (let j = a.i; j <= b.i; j++) neck = Math.max(neck, c[j].high);
      if (neck - Math.min(a.v, b.v) >= 1.0 * atr && crossUp(neck)) {
        push("dbl_bottom", "Double Bottom", 1, neck, Math.min(a.v, b.v), clamp01((neck - Math.min(a.v, b.v)) / (3 * atr)), "Second test of the same low held; neckline broken.");
      }
    }
  }

  // 2) HEAD & SHOULDERS / INVERSE
  if (hi.length >= 3) {
    const [ls, hd, rs] = hi.slice(-3);
    if (rs.i - ls.i <= 80 && hd.v - Math.max(ls.v, rs.v) >= 0.5 * atr && Math.abs(ls.v - rs.v) <= 0.6 * atr) {
      let t1 = Infinity, t2 = Infinity;
      for (let j = ls.i; j <= hd.i; j++) t1 = Math.min(t1, c[j].low);
      for (let j = hd.i; j <= rs.i; j++) t2 = Math.min(t2, c[j].low);
      const neck = (t1 + t2) / 2;
      if (crossDown(neck)) push("head_shoulders", "Head & Shoulders", -1, neck, rs.v, clamp01((hd.v - neck) / (3 * atr)), "Three peaks, middle highest; neckline broken.");
    }
  }
  if (lo.length >= 3) {
    const [ls, hd, rs] = lo.slice(-3);
    if (rs.i - ls.i <= 80 && Math.min(ls.v, rs.v) - hd.v >= 0.5 * atr && Math.abs(ls.v - rs.v) <= 0.6 * atr) {
      let t1 = -Infinity, t2 = -Infinity;
      for (let j = ls.i; j <= hd.i; j++) t1 = Math.max(t1, c[j].high);
      for (let j = hd.i; j <= rs.i; j++) t2 = Math.max(t2, c[j].high);
      const neck = (t1 + t2) / 2;
      if (crossUp(neck)) push("inv_head_shoulders", "Inverse Head & Shoulders", 1, neck, rs.v, clamp01((neck - hd.v) / (3 * atr)), "Three troughs, middle lowest; neckline broken.");
    }
  }

  // 3) TRIANGLES (ascending / descending / symmetrical): trendlines through the last 2 swing highs and 2 swing lows
  if (hi.length >= 2 && lo.length >= 2) {
    const h1 = hi[hi.length - 2], h2 = hi[hi.length - 1], l1 = lo[lo.length - 2], l2 = lo[lo.length - 1];
    const span = Math.max(h2.i, l2.i) - Math.min(h1.i, l1.i);
    if (span >= 12 && span <= 80 && h2.i - h1.i >= 4 && l2.i - l1.i >= 4) {
      const U = line(h1, h2), D = line(l1, l2);
      const w0 = U.at(Math.min(h1.i, l1.i)) - D.at(Math.min(h1.i, l1.i));
      const w1 = U.at(L) - D.at(L);
      const flat = 0.15 * atr / 10; // slope per bar considered "flat"
      const converging = w1 > 0 && w1 < 0.75 * w0 && w0 > 1.0 * atr;
      if (converging) {
        const upFlat = Math.abs(U.m) <= flat, dnFlat = Math.abs(D.m) <= flat;
        const kind = upFlat && D.m > flat ? "asc" : dnFlat && U.m < -flat ? "desc" : U.m < -flat && D.m > flat ? "sym" : null;
        if (kind) {
          const nameK = { asc: "Ascending Triangle", desc: "Descending Triangle", sym: "Symmetrical Triangle" }[kind];
          const up = U.at(L), dn = D.at(L);
          if (close > up + 0.1 * atr && prevClose <= U.at(L - 1) + 0.1 * atr && kind !== "desc")
            push(`tri_${kind}_up`, nameK, 1, up, dn, clamp01(w0 / (3 * atr)), "Price squeezed between converging lines; upper line broken.");
          else if (close < dn - 0.1 * atr && prevClose >= D.at(L - 1) - 0.1 * atr && kind !== "asc")
            push(`tri_${kind}_dn`, nameK, -1, dn, up, clamp01(w0 / (3 * atr)), "Price squeezed between converging lines; lower line broken.");
        }
      }
    }
  }

  // 4) FLAG: sharp impulse (>= 2.5 ATR inside 10 bars), then 5-15 bars of tight counter-drift, then break in impulse direction
  for (let cons = 5; cons <= 15; cons++) {
    const e = L - 1 - cons + 1;              // first consolidation bar index
    const impEnd = e - 1;
    const impStart = impEnd - 9;
    if (impStart < s) break;
    let hiI = -Infinity, loI = Infinity, hiP = 0, loP = 0;
    for (let j = impStart; j <= impEnd; j++) {
      if (c[j].high > hiI) { hiI = c[j].high; hiP = j; }
      if (c[j].low < loI) { loI = c[j].low; loP = j; }
    }
    const up = hiP > loP;
    const imp = hiI - loI;
    if (imp < 2.5 * atr) continue;
    let ch = -Infinity, cl = Infinity;
    for (let j = e; j <= L - 1; j++) { ch = Math.max(ch, c[j].high); cl = Math.min(cl, c[j].low); }
    const range = ch - cl;
    const retr = up ? (hiI - cl) / imp : (ch - loI) / imp;
    if (range > 0.45 * imp || retr > 0.5 || retr < 0.05) continue;
    if (up && crossUp(ch)) { push("bull_flag", "Bull Flag", 1, ch, cl, clamp01(imp / (4 * atr)), "Sharp rise, shallow pause, break to the upside."); break; }
    if (!up && crossDown(cl)) { push("bear_flag", "Bear Flag", -1, cl, ch, clamp01(imp / (4 * atr)), "Sharp fall, shallow pause, break to the downside."); break; }
  }

  // 5) BOX / RANGE BREAKOUT: tight box of 12-20 bars (height <= 2.2 ATR) broken with a close
  for (const len of [12, 16, 20]) {
    if (L - len < s) continue;
    let bh = -Infinity, bl = Infinity;
    for (let j = L - len; j <= L - 1; j++) { bh = Math.max(bh, c[j].high); bl = Math.min(bl, c[j].low); }
    if (bh - bl > 2.2 * atr || bh - bl < 0.5 * atr) continue;
    if (crossUp(bh)) { push("box_break_up", "Box Breakout (up)", 1, bh, bl, clamp01(1 - (bh - bl) / (2.2 * atr)), `Tight ${len}-bar range broken upward.`); break; }
    if (crossDown(bl)) { push("box_break_dn", "Box Breakdown", -1, bl, bh, clamp01(1 - (bh - bl) / (2.2 * atr)), `Tight ${len}-bar range broken downward.`); break; }
  }

  // 6) INSIDE-BAR BREAKOUT: mother bar followed by 1-3 inside bars, then a close beyond the mother's range
  for (let k = 1; k <= 3; k++) {
    const m = L - 1 - k;
    if (m < s) break;
    let inside = true;
    for (let j = m + 1; j <= L - 1; j++) if (!(c[j].high <= c[m].high && c[j].low >= c[m].low)) { inside = false; break; }
    if (!inside) continue;
    const range = c[m].high - c[m].low;
    if (range < 0.8 * atr) continue;
    if (c[L].close > c[m].high + 0.1 * atr) { push("inside_break_up", "Inside-Bar Breakout (up)", 1, c[m].high, c[m].low, clamp01(range / (2.5 * atr)), "Compression bar(s) inside a big bar, then upside break."); break; }
    if (c[L].close < c[m].low - 0.1 * atr) { push("inside_break_dn", "Inside-Bar Breakdown", -1, c[m].low, c[m].high, clamp01(range / (2.5 * atr)), "Compression bar(s) inside a big bar, then downside break."); break; }
  }

  return out;
}
