// lib/marketRegime.js

export function detectMarketRegime(candles) {
  if (!candles || candles.length < 20) return "NORMAL";

  const recentSlice = candles.slice(-14);
  const highLowDiffs = recentSlice.map((c) => c.high - c.low);
  const avgVolatility =
    highLowDiffs.reduce((a, b) => a + b, 0) / highLowDiffs.length;

  if (avgVolatility < 4) {
    return "CHOPPY_SIDEWAYS";
  }
  return "TRENDY_MOMENTUM";
}

export function checkIndicatorConflicts(scores = {}) {
  // Safe fallback if scores is undefined or null
  const safeScores = scores || {};
  const vwapBullish = (safeScores.vwapScore || 0) > 0;
  const macdBullish = (safeScores.macdScore || 0) > 0;

  if (vwapBullish !== macdBullish) {
    return {
      hasConflict: true,
      message: "Conflict: VWAP and MACD directions mismatch!",
    };
  }
  return { hasConflict: false, message: "All indicators aligned" };
}
