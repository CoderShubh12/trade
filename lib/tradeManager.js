// lib/tradeManager.js

// 1. ट्रेड ट्रिगर चेक करने का फंक्शन
export function evaluateTradeSetup(
  compositeScore,
  niftyBias,
  currentCandle,
  vwap,
  atr,
) {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTimeVal = hours * 60 + minutes;

  // High-momentum windows (09:30 - 11:30 और 01:30 - 02:45)
  const morningSession =
    currentTimeVal >= 9 * 60 + 30 && currentTimeVal <= 11 * 60 + 30;
  const afternoonSession =
    currentTimeVal >= 13 * 60 + 30 && currentTimeVal <= 14 * 60 + 45;

  if (!morningSession && !afternoonSession) {
    return { action: "WAIT", reason: "Outside High-Momentum Window" };
  }

  // BUY Setup Condition (Score >= +65)
  if (compositeScore >= 65 && niftyBias !== "BEARISH") {
    const entryPrice = currentCandle.close;
    return {
      action: "BUY",
      entry: entryPrice,
      stopLoss: entryPrice - atr * 1.5,
      target1: entryPrice + atr * 2.2,
      target2: entryPrice + atr * 3.5,
      maxTime: Date.now() + 25 * 60 * 1000, // 25 मिनट का डिकेड टाइमर
    };
  }

  // SELL Setup Condition (Score <= -65)
  if (compositeScore <= -65 && niftyBias !== "BULLISH") {
    const entryPrice = currentCandle.close;
    return {
      action: "SELL",
      entry: entryPrice,
      stopLoss: entryPrice + atr * 1.5,
      target1: entryPrice - atr * 2.2,
      target2: entryPrice - atr * 3.5,
      maxTime: Date.now() + 25 * 60 * 1000,
    };
  }

  return {
    action: "WAIT",
    reason: "Score within neutral threshold (-65 to +65)",
  };
}

// 2. एक्टिव ट्रेड को मॉनिटर करने का फंक्शन
export function monitorActiveTrade(activeTrade, currentPrice, currentVwap) {
  if (!activeTrade) return null;

  // Stagnation Timeout Check (25 minutes expiry)
  if (Date.now() > activeTrade.maxTime) {
    return { exit: true, reason: "TIME_DECAY_TIMEOUT (25m reached)" };
  }

  // VWAP Breach Buffer Check
  const vwapBuffer = currentVwap * 0.0005;
  if (activeTrade.action === "BUY" && currentPrice < currentVwap - vwapBuffer) {
    return { exit: true, reason: "VWAP_BREACH_EXIT" };
  }
  if (
    activeTrade.action === "SELL" &&
    currentPrice > currentVwap + vwapBuffer
  ) {
    return { exit: true, reason: "VWAP_BREACH_EXIT" };
  }

  // Target & Stop-Loss Hits
  if (activeTrade.action === "BUY") {
    if (currentPrice >= activeTrade.target2)
      return { exit: true, reason: "TARGET_2_HIT" };
    if (currentPrice <= activeTrade.stopLoss)
      return { exit: true, reason: "STOP_LOSS_HIT" };
  } else if (activeTrade.action === "SELL") {
    if (currentPrice <= activeTrade.target2)
      return { exit: true, reason: "TARGET_2_HIT" };
    if (currentPrice >= activeTrade.stopLoss)
      return { exit: true, reason: "STOP_LOSS_HIT" };
  }

  return { exit: false, reason: "HOLD" };
}
