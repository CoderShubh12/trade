// lib/reversalBot.js
// REVERSAL ALERT BOT (alert only: it never places or blocks a trade).
// Idea: after the index has made a real move (default 0.5%) from the day's high down to a low (or low up to a high), the low/high has had time to
// form (10-60 min ago) and price has now bounced/faded 0.2% away from it, say so. The detector is pure (no imports) so the same code runs live and in the replay.
// Honest status: UNVALIDATED until analysis/reversal_replay.mjs shows a stable out-of-sample result. Treat alerts as "look at the chart", not as entries.
export const REV_CFG = { minMovePct: 0.5, bouncePct: 0.2, minAgeMin: 10, maxAgeMin: 60, cooldownMin: 45 };

const IST_MS = 330 * 60000;
export const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);

export function newRevState() {
  return { day: "", high: 0, low: 0, hiTs: 0, loTs: 0, last: { UP: 0, DOWN: 0 } };
}

// state is mutated in place; returns an alert object or null
export function updateReversal(st, tsMs, price, cfg = REV_CFG) {
  if (!(price > 0) || !(tsMs > 0)) return null;
  const day = istDay(tsMs);
  if (day !== st.day) { st.day = day; st.high = st.low = price; st.hiTs = st.loTs = tsMs; st.last = { UP: 0, DOWN: 0 }; return null; }
  if (price > st.high) { st.high = price; st.hiTs = tsMs; }
  if (price < st.low) { st.low = price; st.loTs = tsMs; }
  const mins = (t) => (tsMs - t) / 60000;
  // bullish reversal: fell from the high to a low, low is newer than the high, then bounced
  const fall = ((st.high - st.low) / st.high) * 100, bounce = ((price - st.low) / st.low) * 100, ageLow = mins(st.loTs);
  if (st.loTs > st.hiTs && fall >= cfg.minMovePct && bounce >= cfg.bouncePct && ageLow >= cfg.minAgeMin && ageLow <= cfg.maxAgeMin && mins(st.last.UP) >= cfg.cooldownMin) {
    st.last.UP = tsMs;
    return { dir: "UP", ts: tsMs, price, extreme: st.low, movePct: +fall.toFixed(2), turnPct: +bounce.toFixed(2), ageMin: Math.round(ageLow), note: `Fell ${fall.toFixed(2)}% from day high to ${st.low}, now +${bounce.toFixed(2)}% off the low (low was ${Math.round(ageLow)} min ago)` };
  }
  // bearish reversal: rose from the low to a high, high is newer than the low, then faded
  const rise = ((st.high - st.low) / st.low) * 100, fade = ((st.high - price) / st.high) * 100, ageHigh = mins(st.hiTs);
  if (st.hiTs > st.loTs && rise >= cfg.minMovePct && fade >= cfg.bouncePct && ageHigh >= cfg.minAgeMin && ageHigh <= cfg.maxAgeMin && mins(st.last.DOWN) >= cfg.cooldownMin) {
    st.last.DOWN = tsMs;
    return { dir: "DOWN", ts: tsMs, price, extreme: st.high, movePct: +rise.toFixed(2), turnPct: +fade.toFixed(2), ageMin: Math.round(ageHigh), note: `Rose ${rise.toFixed(2)}% from day low to ${st.high}, now -${fade.toFixed(2)}% off the high (high was ${Math.round(ageHigh)} min ago)` };
  }
  return null;
}
