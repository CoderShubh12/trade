// lib/candlestickEngine.js
// Multi-Candle Price Action Pattern Engine with Context Analysis

// `lastIsClosed: true` means the last candle in the array is already finished
// (REPLAY mode, or an array already cut to closed candles). The default keeps
// the old live behaviour: the last candle is still forming, so skip it.
export function detectCandlePattern(candles, { lastIsClosed = false } = {}) {
  const offset = lastIsClosed ? 1 : 2;
  // Need 3 fully closed candles (+1 forming candle in live mode)
  if (!candles || candles.length < offset + 2) {
    return {
      name: "Normal Candle",
      bias: "NEUTRAL",
      type: "NONE",
      score: 0,
      tooltip: "Analyzing price action. Minimum 3 completed bars required.",
    };
  }

  // Use fully closed candles only to avoid intra-candle false triggers
  const curr = candles[candles.length - offset]; // Last completed/closed candle
  const prev = candles[candles.length - offset - 1]; // 2nd last completed candle
  const prev2 = candles[candles.length - offset - 2]; // 3rd last completed candle

  const body = Math.abs(curr.close - curr.open);
  const range = curr.high - curr.low || 0.001;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  const isGreen = curr.close >= curr.open;
  const isRed = curr.close < curr.open;

  const prevBody = Math.abs(prev.close - prev.open);
  const prevIsRed = prev.close < prev.open;
  const prevIsGreen = prev.close > prev.open;

  // 1. HAMMER / BULLISH PIN BAR (Rejection of lower price)
  if (
    lowerWick >= 2 * body &&
    upperWick <= body * 0.35 &&
    lowerWick / range >= 0.55
  ) {
    return {
      name: "Hammer (Bullish Pin)",
      bias: "BULLISH",
      type: "REVERSAL",
      score: 22,
      tooltip:
        "Hammer: Buyers aggressively rejected lower levels. Action: High chance of upward bounce if price breaks candle high.",
    };
  }

  // 2. SHOOTING STAR / BEARISH PIN BAR (Rejection of higher price)
  if (
    upperWick >= 2 * body &&
    lowerWick <= body * 0.35 &&
    upperWick / range >= 0.55
  ) {
    return {
      name: "Shooting Star (Bearish Pin)",
      bias: "BEARISH",
      type: "REVERSAL",
      score: -22,
      tooltip:
        "Shooting Star: Sellers aggressively rejected higher levels. Action: High chance of downward reversal if price breaks candle low.",
    };
  }

  // 3. BULLISH ENGULFING (Green body completely covers previous red body)
  if (
    isGreen &&
    prevIsRed &&
    curr.open <= prev.close &&
    curr.close >= prev.open &&
    body > prevBody
  ) {
    return {
      name: "Bullish Engulfing",
      bias: "BULLISH",
      type: "REVERSAL",
      score: 25,
      tooltip:
        "Bullish Engulfing: Current green bar completely swallows previous red bar. Action: Buyers are in total control.",
    };
  }

  // 4. BEARISH ENGULFING (Red body completely covers previous green body)
  if (
    isRed &&
    prevIsGreen &&
    curr.open >= prev.close &&
    curr.close <= prev.open &&
    body > prevBody
  ) {
    return {
      name: "Bearish Engulfing",
      bias: "BEARISH",
      type: "REVERSAL",
      score: -25,
      tooltip:
        "Bearish Engulfing: Current red bar completely swallows previous green bar. Action: Institutional supply active; exit longs.",
    };
  }

  // 5. BULLISH MARUBOZU (Full body green candle with minimal wicks)
  if (isGreen && body / range >= 0.85) {
    return {
      name: "Bullish Marubozu",
      bias: "BULLISH",
      type: "MOMENTUM",
      score: 20,
      tooltip:
        "Bullish Marubozu: Strong institutional buying with near-zero wicks. Action: Strong trend continuation; do not short.",
    };
  }

  // 6. BEARISH MARUBOZU (Full body red candle with minimal wicks)
  if (isRed && body / range >= 0.85) {
    return {
      name: "Bearish Marubozu",
      bias: "BEARISH",
      type: "MOMENTUM",
      score: -20,
      tooltip:
        "Bearish Marubozu: Heavy institutional selling with near-zero wicks. Action: Strong downward continuation; do not buy.",
    };
  }

  // 7. MORNING STAR (3-Candle Bottom Reversal)
  if (
    prev2.close < prev2.open &&
    Math.abs(prev.close - prev.open) / (prev.high - prev.low || 1) < 0.35 &&
    isGreen &&
    curr.close > (prev2.open + prev2.close) / 2
  ) {
    return {
      name: "Morning Star",
      bias: "BULLISH",
      type: "REVERSAL",
      score: 25,
      tooltip:
        "Morning Star: 3-candle bottom reversal confirmed. Action: Downward move exhausted; buying momentum ready.",
    };
  }

  // 8. EVENING STAR (3-Candle Top Reversal)
  if (
    prev2.close > prev2.open &&
    Math.abs(prev.close - prev.open) / (prev.high - prev.low || 1) < 0.35 &&
    isRed &&
    curr.close < (prev2.open + prev2.close) / 2
  ) {
    return {
      name: "Evening Star",
      bias: "BEARISH",
      type: "REVERSAL",
      score: -25,
      tooltip:
        "Evening Star: 3-candle top reversal confirmed. Action: Upward momentum exhausted; sellers taking control.",
    };
  }

  // 9. DOJI (Indecision Bar)
  if (body / range <= 0.1) {
    return {
      name: "Doji (Indecision)",
      bias: "NEUTRAL",
      type: "INDECISION",
      score: 0,
      tooltip:
        "Doji: Equal tug-of-war between buyers and sellers. Action: Wait for clear breakout confirmation.",
    };
  }

  // Standard Candles Flow
  return {
    name: isGreen ? "Bullish Continuation" : "Bearish Continuation",
    bias: isGreen ? "MILD_BULLISH" : "MILD_BEARISH",
    type: "FLOW",
    score: isGreen ? 5 : -5,
    tooltip: isGreen
      ? "Standard Green Candle: Moderate buying pressure. Normal price flow."
      : "Standard Red Candle: Moderate selling pressure. Normal price flow.",
  };
}
