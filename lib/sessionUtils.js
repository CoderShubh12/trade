// lib/sessionUtils.js
// Helpers that make the engine "session aware":
//  - Angel One returns several days of candles in one array.
//    VWAP, Opening Range and CPR must be calculated PER TRADING DAY,
//    not across the whole array.
//  - All clock checks use IST (Asia/Kolkata), not the computer's timezone.
//  - A candle that is still forming must never be used to fire a signal.

const IST_OFFSET_MS = 330 * 60 * 1000; // UTC+05:30

// Break a timestamp (ms) into IST parts. Works the same on any computer.
export function getIstParts(ms = Date.now()) {
  const d = new Date(ms + IST_OFFSET_MS);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    dateStr: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    day: d.getUTCDay(), // 0 = Sunday ... 6 = Saturday
    hhmm: hours * 100 + minutes, // 9:15 -> 915, 15:30 -> 1530
  };
}

// NSE cash session: Mon-Fri, 09:15 to 15:30 IST.
// NOTE: there is no exchange-holiday calendar here. On a holiday the data
// freshness check (isDataFresh) is what stops stale signals.
export function isMarketOpenIST(ms = Date.now()) {
  const { day, hhmm } = getIstParts(ms);
  if (day === 0 || day === 6) return false;
  return hhmm >= 915 && hhmm <= 1530;
}

// Which trading day does this candle belong to? (IST date, "YYYY-MM-DD")
export function getCandleSessionKey(candle) {
  if (candle?.date) return candle.date;
  if (candle?.time) return getIstParts(candle.time * 1000).dateStr;
  return "unknown";
}

// Where does the latest trading day start inside the candle array?
// Also returns the previous trading day's candles (used for CPR).
export function getSessionInfo(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { startIdx: 0, today: [], previous: null, hasPrevSession: false };
  }

  const lastKey = getCandleSessionKey(candles[candles.length - 1]);
  let startIdx = candles.length - 1;
  while (
    startIdx > 0 &&
    getCandleSessionKey(candles[startIdx - 1]) === lastKey
  ) {
    startIdx--;
  }

  let previous = null;
  if (startIdx > 0) {
    const prevKey = getCandleSessionKey(candles[startIdx - 1]);
    let prevStart = startIdx - 1;
    while (
      prevStart > 0 &&
      getCandleSessionKey(candles[prevStart - 1]) === prevKey
    ) {
      prevStart--;
    }
    previous = candles.slice(prevStart, startIdx);
  }

  return {
    startIdx,
    today: candles.slice(startIdx),
    previous,
    hasPrevSession: !!previous && previous.length > 0,
  };
}

// A candle is "forming" while its time bucket has not finished yet.
export function isCandleForming(candle, tfMinutes, nowMs = Date.now()) {
  if (!candle?.time) return false;
  return candle.time * 1000 + tfMinutes * 60 * 1000 > nowMs;
}

// Returns only fully closed candles (drops the last one if still forming).
// Signals must be calculated on THIS array, so they never repaint.
export function getClosedCandles(candles, tfMinutes, nowMs = Date.now()) {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const last = candles[candles.length - 1];
  return isCandleForming(last, tfMinutes, nowMs)
    ? candles.slice(0, -1)
    : candles;
}

// Fresh = the newest candle belongs to today (IST) and is not older than
// `maxLagCandles` candle-lengths. Prevents signals on Friday's data
// on a Sunday night, or when the feed has silently stopped.
export function isDataFresh(
  candles,
  tfMinutes,
  nowMs = Date.now(),
  maxLagCandles = 2,
) {
  if (!Array.isArray(candles) || candles.length === 0) return false;
  const last = candles[candles.length - 1];
  if (!last?.time) return false;
  if (getCandleSessionKey(last) !== getIstParts(nowMs).dateStr) return false;
  const lastStart = last.time * 1000;
  return nowMs <= lastStart + (1 + maxLagCandles) * tfMinutes * 60 * 1000;
}

// ---------------------------------------------------------------------
// Trade window (all times IST, as HHMM numbers). Edit here to change the
// working zone. Defaults keep the windows that were already in the app.
// ---------------------------------------------------------------------
export const TRADE_WINDOW = {
  enforce: true, // set false to allow signals at any time of the session
  entryWindows: [
    { start: 930, end: 1130, label: "Morning momentum" },
    { start: 1330, end: 1445, label: "Afternoon momentum" },
  ],
  squareOffAt: 1515, // hard exit for every open intraday trade
};

export function getTradeWindowStatus(ms = Date.now()) {
  const { hhmm } = getIstParts(ms);
  if (hhmm >= TRADE_WINDOW.squareOffAt) {
    return { allowed: false, reason: "After 03:15 PM square-off time" };
  }
  if (!TRADE_WINDOW.enforce) return { allowed: true, reason: "Window off" };
  const hit = TRADE_WINDOW.entryWindows.find(
    (w) => hhmm >= w.start && hhmm <= w.end,
  );
  if (hit) return { allowed: true, reason: hit.label };
  if (hhmm < 930) {
    return { allowed: false, reason: "Opening range forming (before 09:30)" };
  }
  return { allowed: false, reason: "Outside entry window (midday / late)" };
}

// One place that answers: "is it safe to generate a LIVE signal right now?"
export function getLiveSignalGate(candles, tfMinutes, nowMs = Date.now()) {
  if (!isMarketOpenIST(nowMs)) {
    return {
      allowed: false,
      reason: "Market closed - live signals paused (use REPLAY to test)",
    };
  }
  if (!isDataFresh(candles, tfMinutes, nowMs)) {
    return {
      allowed: false,
      reason: "Feed is stale or not today's data - live signals paused",
    };
  }
  return { allowed: true, reason: "Live feed OK" };
}
