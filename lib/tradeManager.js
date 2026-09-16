// lib/tradeManager.js
const round2 = (num) => Number(Number(num).toFixed(2));

export async function getGroqTradeApproval({
  symbol,
  side,
  entryPrice,
  timeframe = "5",
  compositeScore,
  niftyBias,
  vwap,
  atr,
  regime = "TRENDY_MOMENTUM",
}) {
  try {
    const res = await fetch("/api/ai-analyst", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        ltp: entryPrice,
        timeframe,
        score: compositeScore,
        regime,
        side,
        vwap,
        atr,
      }),
    });

    const json = await res.json();
    if (json.success && json.data) {
      return json.data;
    }
  } catch (err) {
    console.warn("Groq validation fallback to math:", err.message);
  }

  return {
    confidenceScore: 70,
    timeframeValidity: `${timeframe}M Setup`,
    reason: "Pure technical indicator alignment",
    riskWarning: "Strict trailing SL advised",
  };
}

export async function evaluateTradeSetup(
  compositeScore,
  niftyBias,
  currentCandle,
  vwap,
  atr,
  options = {},
) {
  const {
    bypassTimeWindow = true,
    useGroqValidation = false,
    symbol = "STOCK",
    timeframe = "5",
    regime = "TRENDY_MOMENTUM",
  } = options;

  if (!currentCandle || !currentCandle.close) {
    return { action: "WAIT", reason: "Invalid candle data" };
  }

  const now = new Date();
  const timeNum = now.getHours() * 100 + now.getMinutes();

  if (!bypassTimeWindow && timeNum >= 1500) {
    return { action: "WAIT", reason: "Market closing phase (Post 03:00 PM)" };
  }

  const isMomentumTime =
    (timeNum >= 930 && timeNum <= 1130) || (timeNum >= 1330 && timeNum <= 1445);

  if (!bypassTimeWindow && !isMomentumTime) {
    return { action: "WAIT", reason: "Outside High-Momentum Window" };
  }

  const entryPrice = currentCandle.close;
  const safeAtr = Math.max(entryPrice * 0.004, atr || entryPrice * 0.008);

  let detectedSide = null;
  if (compositeScore >= 65 && niftyBias !== "BEARISH") {
    detectedSide = "BUY";
  } else if (compositeScore <= -65 && niftyBias !== "BULLISH") {
    detectedSide = "SELL";
  }

  if (!detectedSide) {
    return { action: "WAIT", reason: `Consolidation (${compositeScore} pts)` };
  }

  let aiInsights = null;
  if (useGroqValidation) {
    aiInsights = await getGroqTradeApproval({
      symbol,
      side: detectedSide,
      entryPrice,
      timeframe,
      compositeScore,
      niftyBias,
      vwap,
      atr: safeAtr,
      regime,
    });

    if (aiInsights && aiInsights.confidenceScore < 60) {
      return {
        action: "WAIT",
        reason: `AI VETO: Low Confidence (${aiInsights.confidenceScore}%) - ${aiInsights.reason || "High chop probability"}`,
      };
    }
  }

  const isBuy = detectedSide === "BUY";
  const stopLoss = round2(
    isBuy ? entryPrice - safeAtr * 1.2 : entryPrice + safeAtr * 1.2,
  );
  const target1 = round2(
    isBuy ? entryPrice + safeAtr * 2.0 : entryPrice - safeAtr * 2.0,
  );
  const target2 = round2(
    isBuy ? entryPrice + safeAtr * 3.5 : entryPrice - safeAtr * 3.5,
  );

  return {
    action: detectedSide,
    entry: round2(entryPrice),
    stopLoss,
    target1,
    target2,
    maxTime: Date.now() + 25 * 60 * 1000,
    t1Reached: false,
    initialSl: stopLoss,
    aiConfidence: aiInsights?.confidenceScore || null,
    aiTimeframe: aiInsights?.timeframeValidity || `${timeframe}M session`,
    aiReason: aiInsights?.reason || null,
    aiWarning: aiInsights?.riskWarning || null,
  };
}

export function monitorActiveTrade(activeTrade, currentPrice, currentVwap) {
  if (!activeTrade || !currentPrice) return null;

  const now = new Date();
  const timeNum = now.getHours() * 100 + now.getMinutes();

  if (timeNum >= 1515) {
    return {
      exit: true,
      reason: "MARKET_CLOSE_SQUAREOFF (03:15 PM Auto-Exit)",
    };
  }

  if (Date.now() > activeTrade.maxTime) {
    return { exit: true, reason: "TIME_DECAY_TIMEOUT (25m reached)" };
  }

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

  if (activeTrade.action === "BUY") {
    if (currentPrice >= activeTrade.target2) {
      return { exit: true, reason: "TARGET_2_HIT" };
    }
    if (currentPrice >= activeTrade.target1 && !activeTrade.t1Reached) {
      activeTrade.t1Reached = true;
      activeTrade.stopLoss = round2(activeTrade.entry * 1.001);
      return {
        exit: false,
        isPartial: true,
        reason: "TARGET_1_HIT_TRAIL_SL_TO_COST",
        newSl: activeTrade.stopLoss,
      };
    }
    if (currentPrice <= activeTrade.stopLoss) {
      return {
        exit: true,
        reason: activeTrade.t1Reached ? "TRAILING_SL_HIT" : "STOP_LOSS_HIT",
      };
    }
  } else if (activeTrade.action === "SELL") {
    if (currentPrice <= activeTrade.target2) {
      return { exit: true, reason: "TARGET_2_HIT" };
    }
    if (currentPrice <= activeTrade.target1 && !activeTrade.t1Reached) {
      activeTrade.t1Reached = true;
      activeTrade.stopLoss = round2(activeTrade.entry * 0.999);
      return {
        exit: false,
        isPartial: true,
        reason: "TARGET_1_HIT_TRAIL_SL_TO_COST",
        newSl: activeTrade.stopLoss,
      };
    }
    if (currentPrice >= activeTrade.stopLoss) {
      return {
        exit: true,
        reason: activeTrade.t1Reached ? "TRAILING_SL_HIT" : "STOP_LOSS_HIT",
      };
    }
  }

  return { exit: false, reason: "HOLD" };
}
