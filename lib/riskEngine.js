// lib/riskEngine.js

export function calculatePositionSize(
  accountCapital,
  riskPerTradePercent,
  entryPrice,
  stopLossPrice,
) {
  const maxRiskAmount = accountCapital * (riskPerTradePercent / 100);
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  if (riskPerShare <= 0) return 0;

  const rawQty = Math.floor(maxRiskAmount / riskPerShare);
  return Math.max(1, rawQty); // कम से कम 1 शेयर
}

export function checkDailyRiskLimits(
  dailyTradesCount,
  consecutiveLosses,
  totalPnL,
) {
  // मैक्सिमम ट्रेड्स/दिन: 5, मैक्सिमम कॉन्सेक्यूटिव लॉस: 2, मैक्सिमम डेली लॉस: ₹5,000
  if (dailyTradesCount >= 5) {
    return { allowed: false, reason: "MAX_DAILY_TRADES_REACHED (Limit: 5)" };
  }
  if (consecutiveLosses >= 2) {
    return {
      allowed: false,
      reason: "CONSECUTIVE_LOSS_PROTECTION_TRIGGERED (2 Losses)",
    };
  }
  if (totalPnL <= -5000) {
    return { allowed: false, reason: "MAX_DAILY_LOSS_LIMIT_REACHED" };
  }

  return { allowed: true, reason: "SAFE_TO_TRADE" };
}
