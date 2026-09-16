// lib/marketRegime.js

export function detectMarketRegime(candles) {
  if (!candles || candles.length < 20) return "NORMAL";

  const recentSlice = candles.slice(-14);
  const currentPrice = candles[candles.length - 1]?.close || 1;

  // Average Candle Range (High - Low)
  const highLowDiffs = recentSlice.map((c) => c.high - c.low);
  const avgRange =
    highLowDiffs.reduce((a, b) => a + b, 0) / highLowDiffs.length;

  // Normalized Range Percentage (Stock price ke proportion me)
  const rangePercent = (avgRange / currentPrice) * 100;

  // Agar 14 candles ka average movement 0.12% se kam hai -> Choppy / Sideways
  if (rangePercent < 0.12) {
    return "CHOPPY_SIDEWAYS";
  }
  return "TRENDY_MOMENTUM";
}

export function checkIndicatorConflicts(scores = {}) {
  const safeScores = scores || {};
  const vwapBullish = (safeScores.vwapScore || 0) > 0;
  const macdBullish = (safeScores.macdScore || 0) > 0;
  const trendBullish = (safeScores.trendScore || 0) > 0; // EMA Stack alignment check

  // Conflict 1: VWAP vs MACD
  if (vwapBullish !== macdBullish) {
    return {
      hasConflict: true,
      message: "Indicator Mismatch: VWAP & MACD momentum divergence!",
    };
  }

  // Conflict 2: Fast Trend vs Macro VWAP
  if (trendBullish !== vwapBullish) {
    return {
      hasConflict: true,
      message: "Counter-Trend Trap: EMA stack opposes Session VWAP!",
    };
  }

  return { hasConflict: false, message: "All indicators aligned" };
}
