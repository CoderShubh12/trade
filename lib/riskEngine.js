// lib/riskEngine.js

export function calculatePositionSize(
  accountCapital = 100000,
  riskPerTradePercent = 1.0,
  entryPrice = 100,
  stopLossPrice = 98,
  maxLeverage = 5,
) {
  if (!entryPrice || entryPrice <= 0) return 0;

  const maxRiskAmount = accountCapital * (riskPerTradePercent / 100);
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  if (riskPerShare <= 0) return 0;

  // 1. Risk ke hisab se quantity
  const riskBasedQty = Math.floor(maxRiskAmount / riskPerShare);

  // 2. Margin/Capital purchasing power cap (unrealistic quantity se bachata hai)
  const maxPurchasingPower = accountCapital * maxLeverage;
  const marginBasedQty = Math.floor(maxPurchasingPower / entryPrice);

  // Dono me se jo safe aur realistic ho
  const finalQty = Math.min(riskBasedQty, marginBasedQty);

  return Math.max(1, finalQty);
}

export function checkDailyRiskLimits(
  dailyTradesCount = 0,
  consecutiveLosses = 0,
  totalPnL = 0,
  accountCapital = 100000,
) {
  // Max trades limit: 5
  if (dailyTradesCount >= 5) {
    return { allowed: false, reason: "MAX_DAILY_TRADES_REACHED (Limit: 5)" };
  }

  // Revenge trading block: 2 consecutive losses
  if (consecutiveLosses >= 2) {
    return {
      allowed: false,
      reason: "CONSECUTIVE_LOSS_PROTECTION_TRIGGERED (2 Losses)",
    };
  }

  // Capital-based dynamic loss limit (max 3% ya ₹5,000)
  const maxAllowedLoss = Math.min(accountCapital * 0.03, 5000);
  if (totalPnL <= -maxAllowedLoss) {
    return {
      allowed: false,
      reason: `MAX_DAILY_LOSS_LIMIT_REACHED (-₹${maxAllowedLoss})`,
    };
  }

  return { allowed: true, reason: "SAFE_TO_TRADE" };
}
