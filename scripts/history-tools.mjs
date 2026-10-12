// scripts/history-tools.mjs
// Small pure helpers used by fetch-history.mjs (kept apart so they can be tested).
import { getIstParts } from "../lib/sessionUtils.js";

// Split the period into chunks, each as "YYYY-MM-DD HH:mm" in IST
export function buildChunks(days, chunkDays, nowMs = Date.now()) {
  const chunks = [];
  const dayMs = 24 * 60 * 60 * 1000;
  let endMs = nowMs;
  const startLimit = endMs - days * dayMs;
  while (endMs > startLimit) {
    const startMs = Math.max(startLimit, endMs - chunkDays * dayMs);
    chunks.push({
      from: `${getIstParts(startMs).dateStr} 09:15`,
      to: `${getIstParts(endMs).dateStr} 15:30`,
    });
    endMs = startMs - dayMs;
  }
  return chunks.reverse();
}

// raw Angel row -> the same candle shape the dashboard uses
export function toCandle(row) {
  const ts = String(row[0]);
  return {
    time: Math.floor(new Date(ts).getTime() / 1000),
    date: ts.slice(0, 10),
    clock: ts.slice(11, 16),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]) || 0,
  };
}

// Clean + check the data. Returns candles and human-readable warnings.
export function validate(rawCandles, tf) {
  const warnings = [];
  const byTime = new Map();
  rawCandles.forEach((c) => byTime.set(c.time, c)); // removes duplicates
  let candles = [...byTime.values()].sort((a, b) => a.time - b.time);

  const before = candles.length;
  candles = candles.filter(
    (c) => c.clock >= "09:15" && c.clock < "15:30" && c.high >= c.low && c.low > 0 && Number.isFinite(c.close),
  );
  if (candles.length < before) warnings.push(`${before - candles.length} bad or out-of-hours candles removed`);

  const expected = Math.floor(375 / tf);
  const perDay = new Map();
  candles.forEach((c) => perDay.set(c.date, (perDay.get(c.date) || 0) + 1));
  const shortDays = [...perDay.entries()].filter(([, n]) => n < expected * 0.9);
  if (shortDays.length) warnings.push(`${shortDays.length} day(s) with missing candles (expected ${expected}): ` + shortDays.slice(0, 5).map(([d, n]) => `${d}=${n}`).join(", "));
  return { candles, warnings, dayCount: perDay.size };
}

