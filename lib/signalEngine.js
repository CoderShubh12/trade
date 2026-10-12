// lib/signalEngine.js
// Builds the composite score from a set of candles.
// The page calls this twice:
//   1. with ALL candles          -> live gauge on the dashboard (can move every tick)
//   2. with CLOSED candles only  -> the score that is allowed to fire a signal
import { computeAll } from "./indicators";
import { detectCandlePattern } from "./candlestickEngine";

export function buildCompositeScore(candles, tfMinutes, lastIsClosed = false) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { ind: null, pattern: null, score: 0 };
  }
  const ind = computeAll(candles, tfMinutes);
  const pattern = detectCandlePattern(candles, { lastIsClosed });
  const base = ind?.scores?.technicalScore || 0;
  const boost = pattern?.score || 0;
  const score = Math.max(-100, Math.min(100, Math.round(base * 0.8 + boost)));
  return { ind, pattern, score };
}
