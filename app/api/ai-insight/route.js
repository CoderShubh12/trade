import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function calculateCandleScore(candles = []) {
  if (!candles || candles.length < 2) {
    return {
      score: 50,
      direction: "NEUTRAL",
      patterns: [],
    };
  }

  const recent = candles.slice(-5);
  let bullish = 0;
  let bearish = 0;
  const patterns = [];

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];

    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    const body = Math.abs(close - open);
    const range = Math.max(high - low, 0.0001);

    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    // Basic candle direction
    if (close > open) bullish += 8;
    if (close < open) bearish += 8;

    // Strong bullish candle
    if (close > open && body / range >= 0.65) {
      bullish += 8;
      patterns.push("Strong bullish candle");
    }

    // Strong bearish candle
    if (close < open && body / range >= 0.65) {
      bearish += 8;
      patterns.push("Strong bearish candle");
    }

    // Hammer
    if (lowerWick >= body * 2 && upperWick <= body && close >= open) {
      bullish += 10;
      patterns.push("Hammer / bullish rejection");
    }

    // Shooting star
    if (upperWick >= body * 2 && lowerWick <= body && close <= open) {
      bearish += 10;
      patterns.push("Shooting star / bearish rejection");
    }

    // Doji = uncertainty
    if (body / range <= 0.12) {
      bullish -= 3;
      bearish -= 3;
      patterns.push("Doji / indecision");
    }

    // Previous candle relationship
    if (i > 0) {
      const p = recent[i - 1];

      // Bullish engulfing
      if (
        p.close < p.open &&
        close > open &&
        open <= p.close &&
        close >= p.open
      ) {
        bullish += 15;
        patterns.push("Bullish engulfing");
      }

      // Bearish engulfing
      if (
        p.close > p.open &&
        close < open &&
        open >= p.close &&
        close <= p.open
      ) {
        bearish += 15;
        patterns.push("Bearish engulfing");
      }
    }
  }

  const total = bullish + bearish;

  if (total <= 0) {
    return {
      score: 50,
      direction: "NEUTRAL",
      patterns,
    };
  }

  const bullishPct = (bullish / total) * 100;
  const bearishPct = (bearish / total) * 100;

  if (bullishPct > bearishPct) {
    return {
      score: clamp(bullishPct),
      direction: "BULLISH",
      patterns,
    };
  }

  return {
    score: clamp(bearishPct),
    direction: "BEARISH",
    patterns,
  };
}

function calculateTechnicalConfidence({
  biasScore,
  trend,
  rsi,
  price,
  vwap,
  cprState,
  orbState,
  atr,
  candleResult,
}) {
  let bullish = 0;
  let bearish = 0;

  // Composite bias
  if (biasScore >= 65) bullish += 25;
  else if (biasScore >= 40) bullish += 12;
  else if (biasScore <= -65) bearish += 25;
  else if (biasScore <= -40) bearish += 12;

  // EMA trend
  const trendText = String(trend || "").toLowerCase();

  if (
    trendText.includes("bull") ||
    trendText.includes("up") ||
    trendText.includes("strong buy")
  ) {
    bullish += 15;
  }

  if (
    trendText.includes("bear") ||
    trendText.includes("down") ||
    trendText.includes("strong sell")
  ) {
    bearish += 15;
  }

  // RSI
  const r = Number(rsi);

  if (Number.isFinite(r)) {
    if (r >= 55 && r <= 70) bullish += 10;
    if (r <= 45 && r >= 30) bearish += 10;

    // Extreme RSI reduces confidence because chasing becomes risky.
    if (r > 75) {
      bullish -= 5;
    }

    if (r < 25) {
      bearish -= 5;
    }
  }

  // VWAP
  const p = Number(price);
  const v = Number(vwap);

  if (Number.isFinite(p) && Number.isFinite(v)) {
    if (p > v) bullish += 10;
    if (p < v) bearish += 10;
  }

  // CPR
  const cpr = String(cprState || "").toLowerCase();

  if (cpr.includes("above") || cpr.includes("bull")) {
    bullish += 8;
  }

  if (cpr.includes("below") || cpr.includes("bear")) {
    bearish += 8;
  }

  // ORB
  const orb = String(orbState || "").toLowerCase();

  if (orb.includes("breakout") || orb.includes("above")) {
    bullish += 8;
  }

  if (orb.includes("breakdown") || orb.includes("below")) {
    bearish += 8;
  }

  // Candle confirmation
  if (candleResult.direction === "BULLISH") {
    bullish += 15 * (candleResult.score / 100);
  }

  if (candleResult.direction === "BEARISH") {
    bearish += 15 * (candleResult.score / 100);
  }

  const total = bullish + bearish;

  if (total <= 0) {
    return {
      direction: "WAIT",
      confidence: 0,
      bullish,
      bearish,
    };
  }

  const direction =
    bullish > bearish ? "BUY" : bearish > bullish ? "SELL" : "WAIT";

  const dominant = Math.max(bullish, bearish);
  const weaker = Math.min(bullish, bearish);

  // Agreement between components.
  const agreement = (dominant / total) * 100;

  // Convert technical agreement into a confidence score.
  const confidence = clamp(
    Math.round(
      agreement * 0.65 +
        candleResult.score * 0.2 +
        Math.abs(Number(biasScore) || 0) * 0.15,
    ),
  );

  return {
    direction,
    confidence,
    bullish: Math.round(bullish),
    bearish: Math.round(bearish),
  };
}

export async function POST(request) {
  try {
    const body = await request.json();

    const {
      symbol,
      price,
      vwap,
      rsi,
      orbState,
      biasScore,
      trend,
      cprState,
      atr,

      // NEW:
      candles = [],
      volume,
      relativeVolume,
      macd,
      ema9,
      ema21,
    } = body;

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Gemini API key missing in .env.local",
        },
        { status: 500 },
      );
    }

    // -----------------------------------------
    // 1. CANDLE ANALYSIS
    // -----------------------------------------

    const candleResult = calculateCandleScore(candles);

    // -----------------------------------------
    // 2. TECHNICAL CONFIDENCE
    // -----------------------------------------

    const technical = calculateTechnicalConfidence({
      biasScore,
      trend,
      rsi,
      price,
      vwap,
      cprState,
      orbState,
      atr,
      candleResult,
    });

    // -----------------------------------------
    // 3. RISK QUALITY
    // -----------------------------------------

    const atrValue = Number(atr);
    const priceValue = Number(price);

    let riskQuality = 50;

    if (
      Number.isFinite(atrValue) &&
      atrValue > 0 &&
      Number.isFinite(priceValue) &&
      priceValue > 0
    ) {
      const atrPercent = (atrValue / priceValue) * 100;

      if (atrPercent < 0.4) {
        riskQuality = 75;
      } else if (atrPercent < 0.8) {
        riskQuality = 90;
      } else if (atrPercent < 1.2) {
        riskQuality = 70;
      } else {
        riskQuality = 45;
      }
    }

    // -----------------------------------------
    // 4. TRAP RISK
    // -----------------------------------------

    let trapRisk = 20;

    const rsiValue = Number(rsi);

    if (rsiValue > 75 || rsiValue < 25) {
      trapRisk += 20;
    }

    if (candleResult.patterns.includes("Doji / indecision")) {
      trapRisk += 10;
    }

    if (Math.abs(Number(biasScore) || 0) < 40) {
      trapRisk += 15;
    }

    trapRisk = clamp(trapRisk);

    // -----------------------------------------
    // 5. FINAL CALL SAFETY
    // -----------------------------------------

    let finalSafety =
      technical.confidence * 0.55 +
      candleResult.score * 0.2 +
      riskQuality * 0.15 +
      (100 - trapRisk) * 0.1;

    finalSafety = clamp(Math.round(finalSafety));

    // -----------------------------------------
    // 6. CALL CLASSIFICATION
    // -----------------------------------------

    let call = "WAIT";

    if (
      technical.direction === "BUY" &&
      finalSafety >= 75 &&
      Number(biasScore) >= 65
    ) {
      call = "BUY";
    } else if (
      technical.direction === "SELL" &&
      finalSafety >= 75 &&
      Number(biasScore) <= -65
    ) {
      call = "SELL";
    } else if (finalSafety >= 60) {
      call = "WATCH";
    } else {
      call = "NO TRADE";
    }

    // -----------------------------------------
    // 7. GEMINI DEEP ANALYSIS
    // -----------------------------------------

    const candleText = candles
      .slice(-10)
      .map(
        (c, i) =>
          `${i + 1}. O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? "-"}`,
      )
      .join("\n");

    const prompt = `
You are a senior institutional derivatives desk trader and quantitative analyst
specializing in NSE Indian Equities and F&O.

IMPORTANT:
Do NOT claim that a percentage is a guaranteed probability of profit.
The percentages below are SETUP CONFIDENCE scores, not guaranteed win probability.

Analyze this live intraday state.

[MARKET]
Symbol: ${symbol}
Spot: ₹${price}
VWAP: ₹${vwap}
VWAP Stretch: ₹${(Number(price || 0) - Number(vwap || 0)).toFixed(2)}

[CORE INDICATORS]
Bias Score: ${biasScore}/100
EMA Trend: ${trend}
EMA 9: ${ema9 ?? "N/A"}
EMA 21: ${ema21 ?? "N/A"}
RSI: ${rsi}
MACD: ${macd ?? "N/A"}
CPR: ${cprState || "Neutral"}
ORB: ${orbState}
ATR(14): ₹${atr || "N/A"}
Volume: ${volume ?? "N/A"}
Relative Volume: ${relativeVolume ?? "N/A"}

[LAST 10 CANDLES]
${candleText || "No candle data supplied"}

[DETERMINISTIC ENGINE]
Candle Direction: ${candleResult.direction}
Candle Confirmation: ${Math.round(candleResult.score)}%
Detected Patterns: ${
      candleResult.patterns.length ? candleResult.patterns.join(", ") : "None"
    }

Technical Direction: ${technical.direction}
Technical Confidence: ${technical.confidence}%
Bullish Component Score: ${technical.bullish}
Bearish Component Score: ${technical.bearish}

Risk Quality: ${riskQuality}%
Trap Risk: ${trapRisk}%
Preliminary Final Safety: ${finalSafety}%
Preliminary Call: ${call}

TASK:

Re-evaluate the setup using the candle sequence, VWAP, EMA structure,
RSI, MACD, CPR, ORB, ATR, volume and composite bias.

Give the final answer EXACTLY in this format:

FINAL CALL: BUY / SELL / WATCH / NO TRADE

CALL CONFIDENCE: XX%

CANDLE CONFIRMATION: XX%

INDICATOR AGREEMENT: XX%

TRAP RISK: XX%

RISK QUALITY: XX%

SETUP QUALITY: XX%

ENTRY:
Give a practical entry zone, not an unrealistic single tick.

HARD SL:
Give the invalidation level.

TARGET 1:
Give the first liquidity/ATR target.

TARGET 2:
Give the second target only if structure supports it.

BREAKEVEN:
State exactly when SL should move to entry.

WHY THIS CALL:
Give 4-6 short points based ONLY on the supplied data.

CANDLE VERDICT:
Explain the latest 2-3 candles and whether they confirm or reject the trade.

NO-TRADE CONDITION:
State the exact condition under which the trade should be avoided.

STRICT RULE:
If indicators conflict materially, latest candles are indecisive,
price is around VWAP with no volume confirmation, or risk/reward is poor,
prefer WATCH or NO TRADE over forcing BUY/SELL.
`;

    const ai = new GoogleGenAI({ apiKey });

    const candidateModels = ["models/gemini-3.6-flash"];

    let lastError = null;

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.15,
            maxOutputTokens: 1200,
          },
        });

        if (response?.text) {
          return NextResponse.json({
            success: true,

            // Deterministic engine
            engine: {
              call,
              technicalDirection: technical.direction,
              technicalConfidence: technical.confidence,
              candleConfirmation: Math.round(candleResult.score),
              indicatorAgreement: Math.round(
                (Math.max(technical.bullish, technical.bearish) /
                  Math.max(technical.bullish + technical.bearish, 1)) *
                  100,
              ),
              trapRisk,
              riskQuality,
              finalSafety,
              candlePatterns: candleResult.patterns,
            },

            // Gemini's institutional interpretation
            insight: response.text,
          });
        }
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: lastError || "Unable to generate analysis.",
      },
      { status: 500 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Internal server error",
      },
      { status: 500 },
    );
  }
}
