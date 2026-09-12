// lib/candlestickEngine.js
// Multi-Candle Price Action Pattern Engine with Context Analysis

export function detectCandlePattern(candles) {
  if (!candles || candles.length < 3) {
    return {
      name: "Normal Candle",
      bias: "NEUTRAL",
      type: "NONE",
      score: 0,
      tooltip:
        "Analyzing live price action. Minimum 3 completed bars required.",
    };
  }

  const curr = candles[candles.length - 1]; // Latest live candle
  const prev = candles[candles.length - 2]; // Previous completed candle
  const prev2 = candles[candles.length - 3]; // 2nd previous candle

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

  // 5. BULLISH MARUBOZU (Full body green candle with almost no wicks)
  if (isGreen && body / range >= 0.85) {
    return {
      name: "Bullish Marubozu",
      bias: "BULLISH",
      type: "MOMENTUM",
      score: 20,
      tooltip:
        "Bullish Marubozu: Strong institutional buying with zero wicks. Action: Strong trend continuation; do not short.",
    };
  }

  // 6. BEARISH MARUBOZU (Full body red candle with almost no wicks)
  if (isRed && body / range >= 0.85) {
    return {
      name: "Bearish Marubozu",
      bias: "BEARISH",
      type: "MOMENTUM",
      score: -20,
      tooltip:
        "Bearish Marubozu: Heavy institutional panic selling with zero wicks. Action: Strong downward continuation; do not buy.",
    };
  }

  // 7. MORNING STAR (3-Candle Institutional Bottom Reversal)
  if (
    prevIsRed &&
    Math.abs(prev.close - prev.open) / (prev.high - prev.low || 1) < 0.3 &&
    isGreen &&
    curr.close > (prev2.open + prev2.close) / 2
  ) {
    return {
      name: "Morning Star",
      bias: "BULLISH",
      type: "REVERSAL",
      score: 25,
      tooltip:
        "Morning Star: 3-candle bottom reversal confirmed. Action: Downward move exhausted; buy momentum ready.",
    };
  }

  // 8. DOJI (Indecision Bar)
  if (body / range <= 0.1) {
    return {
      name: "Doji (Indecision)",
      bias: "NEUTRAL",
      type: "INDECISION",
      score: 0,
      tooltip:
        "Doji: Equal tug-of-war between buyers and sellers. Action: Wait for clear candle close above or below this range.",
    };
  }

  // Standard Candles Flow
  return {
    name: isGreen ? "Bullish Continuation" : "Bearish Continuation",
    bias: isGreen ? "MILD_BULLISH" : "MILD_BEARISH",
    type: "FLOW",
    score: isGreen ? 5 : -5,
    tooltip: isGreen
      ? "Standard Green Candle: Moderate buying pressure. Normal price flow without extreme wick rejections."
      : "Standard Red Candle: Moderate selling pressure. Normal price flow without extreme wick rejections.",
  };
}
