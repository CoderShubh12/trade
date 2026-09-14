// app/api/ai-analyst/route.js

import { NextResponse } from "next/server";

const MODEL = "openai/gpt-oss-120b";

const clamp = (n, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Number(n) || 0));

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function candleAnalysis(candles = []) {
  if (!Array.isArray(candles) || candles.length < 2) {
    return {
      score: 50,
      direction: "NEUTRAL",
      patterns: [],
      latest: null,
    };
  }

  const recent = candles.slice(-5);
  let bullish = 0;
  let bearish = 0;
  const patterns = [];

  recent.forEach((c, i) => {
    const o = num(c.open);
    const h = num(c.high);
    const l = num(c.low);
    const cl = num(c.close);

    if ([o, h, l, cl].some((x) => x === null)) return;

    const range = Math.max(h - l, 0.000001);
    const body = Math.abs(cl - o);
    const upperWick = h - Math.max(o, cl);
    const lowerWick = Math.min(o, cl) - l;

    // Candle direction
    if (cl > o) bullish += 7;
    if (cl < o) bearish += 7;

    // Strong body
    if (body / range >= 0.65) {
      if (cl > o) {
        bullish += 8;
        patterns.push("Strong bullish candle");
      } else {
        bearish += 8;
        patterns.push("Strong bearish candle");
      }
    }

    // Hammer
    if (
      lowerWick >= body * 2 &&
      upperWick <= Math.max(body, 0.000001) &&
      cl >= o
    ) {
      bullish += 10;
      patterns.push("Hammer");
    }

    // Shooting star
    if (
      upperWick >= body * 2 &&
      lowerWick <= Math.max(body, 0.000001) &&
      cl <= o
    ) {
      bearish += 10;
      patterns.push("Shooting Star");
    }

    // Doji
    if (body / range <= 0.12) {
      bullish -= 4;
      bearish -= 4;
      patterns.push("Doji / Indecision");
    }

    // Engulfing
    if (i > 0) {
      const p = recent[i - 1];

      const po = num(p.open);
      const pc = num(p.close);

      if (po !== null && pc !== null) {
        // Bullish engulfing
        if (pc < po && cl > o && o <= pc && cl >= po) {
          bullish += 15;
          patterns.push("Bullish Engulfing");
        }

        // Bearish engulfing
        if (pc > po && cl < o && o >= pc && cl <= po) {
          bearish += 15;
          patterns.push("Bearish Engulfing");
        }
      }
    }
  });

  const total = Math.max(bullish + bearish, 1);

  const bullPct = clamp((bullish / total) * 100);
  const bearPct = clamp((bearish / total) * 100);

  return {
    score: Math.round(Math.max(bullPct, bearPct)),
    direction:
      bullPct > bearPct ? "BULLISH" : bearPct > bullPct ? "BEARISH" : "NEUTRAL",
    patterns: [...new Set(patterns)],
    latest: recent[recent.length - 1],
  };
}

function technicalEngine(body) {
  const { score, ind = {}, market = {} } = body;

  const latest = ind?.latest || {};

  let bull = 0;
  let bear = 0;

  const bias = num(score) ?? 0;
  const rsi = num(latest.rsi);
  const price = num(market.price);
  const vwap = num(latest.vwap);

  // ---------------------------------------
  // COMPOSITE BIAS
  // ---------------------------------------

  if (bias >= 65) bull += 25;
  else if (bias >= 45) bull += 12;
  else if (bias <= -65) bear += 25;
  else if (bias <= -45) bear += 12;

  // ---------------------------------------
  // EMA STRUCTURE
  // ---------------------------------------

  const ema9 = num(latest.ema9);
  const ema21 = num(latest.ema21);

  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) bull += 15;
    if (ema9 < ema21) bear += 15;
  }

  // ---------------------------------------
  // VWAP
  // ---------------------------------------

  if (price !== null && vwap !== null) {
    if (price > vwap) bull += 12;
    if (price < vwap) bear += 12;
  }

  // ---------------------------------------
  // RSI
  // ---------------------------------------

  if (rsi !== null) {
    if (rsi >= 55 && rsi <= 70) bull += 10;
    if (rsi >= 30 && rsi <= 45) bear += 10;

    // Extreme RSI = exhaustion risk
    if (rsi > 75) bull -= 6;
    if (rsi < 25) bear -= 6;
  }

  // ---------------------------------------
  // MACD
  // ---------------------------------------

  const macd = num(latest.macd);
  const macdSignal = num(latest.macdSignal);

  if (macd !== null && macdSignal !== null) {
    if (macd > macdSignal) bull += 10;
    if (macd < macdSignal) bear += 10;
  }

  // ---------------------------------------
  // CPR
  // ---------------------------------------

  const cpr = String(ind?.cprState || "").toLowerCase();

  if (cpr.includes("bull") || cpr.includes("above")) {
    bull += 8;
  }

  if (cpr.includes("bear") || cpr.includes("below")) {
    bear += 8;
  }

  // ---------------------------------------
  // ORB
  // ---------------------------------------

  const orb = String(ind?.orbState || "").toLowerCase();

  if (orb.includes("breakout") || orb.includes("above")) {
    bull += 8;
  }

  if (orb.includes("breakdown") || orb.includes("below")) {
    bear += 8;
  }

  const total = Math.max(bull + bear, 1);

  const agreement = (Math.max(bull, bear) / total) * 100;

  let direction = "HOLD";

  if (bull > bear * 1.15) direction = "BUY";
  else if (bear > bull * 1.15) direction = "SELL";

  return {
    direction,
    bullishScore: Math.round(bull),
    bearishScore: Math.round(bear),
    agreement: Math.round(agreement),
  };
}

function riskEngine(body, candle, technical) {
  const latest = body?.ind?.latest || {};

  const price = num(body?.market?.price);
  const atr = num(latest?.atr);

  let riskQuality = 70;
  let volatilityRisk = 30;

  if (price !== null && atr !== null && price > 0) {
    const atrPct = (atr / price) * 100;

    if (atrPct < 0.35) {
      riskQuality = 60;
      volatilityRisk = 20;
    } else if (atrPct < 0.8) {
      riskQuality = 90;
      volatilityRisk = 25;
    } else if (atrPct < 1.2) {
      riskQuality = 75;
      volatilityRisk = 50;
    } else {
      riskQuality = 45;
      volatilityRisk = 80;
    }
  }

  let trapRisk = 20;

  const rsi = num(latest?.rsi);

  if (rsi !== null && (rsi > 75 || rsi < 25)) {
    trapRisk += 20;
  }

  if (candle.patterns.includes("Doji / Indecision")) {
    trapRisk += 12;
  }

  if (technical.agreement < 60) {
    trapRisk += 20;
  }

  if (body?.market?.volumeConfirmed === false) {
    trapRisk += 15;
  }

  trapRisk = clamp(trapRisk);

  const candleConfirmation = candle.score;

  const setupQuality = clamp(
    technical.agreement * 0.4 +
      candleConfirmation * 0.25 +
      riskQuality * 0.2 +
      (100 - trapRisk) * 0.15,
  );

  return {
    riskQuality: Math.round(riskQuality),
    volatilityRisk: Math.round(volatilityRisk),
    trapRisk: Math.round(trapRisk),
    setupQuality: Math.round(setupQuality),
  };
}

export async function POST(req) {
  try {
    // ---------------------------------------
    // API KEY
    // ---------------------------------------

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "GROQ_API_KEY is missing in .env.local",
        },
        { status: 500 },
      );
    }

    // ---------------------------------------
    // REQUEST
    // ---------------------------------------

    const body = await req.json().catch(() => ({}));

    const {
      symbol = "UNKNOWN",
      score = 0,
      ind = {},
      pattern = {},
      candles = [],
      market = {},
      previousSignal = null,
    } = body;

    // ---------------------------------------
    // LOCAL DETERMINISTIC ENGINES
    // ---------------------------------------

    const candle = candleAnalysis(candles);

    const technical = technicalEngine({
      score,
      ind,
      market,
    });

    const risk = riskEngine(
      {
        ...body,
        candles,
      },
      candle,
      technical,
    );

    // ---------------------------------------
    // PRELIMINARY CALL
    // ---------------------------------------

    let preliminaryCall = "HOLD";

    if (
      technical.direction === "BUY" &&
      risk.setupQuality >= 72 &&
      risk.trapRisk < 45
    ) {
      preliminaryCall = "BUY";
    }

    if (
      technical.direction === "SELL" &&
      risk.setupQuality >= 72 &&
      risk.trapRisk < 45
    ) {
      preliminaryCall = "SELL";
    }

    if (risk.setupQuality < 55) {
      preliminaryCall = "NO TRADE";
    }

    // ---------------------------------------
    // CANDLE DATA FOR AI
    // ---------------------------------------

    const candleText = Array.isArray(candles)
      ? candles
          .slice(-10)
          .map(
            (c, i) =>
              `${i + 1}. O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? "N/A"}`,
          )
          .join("\n")
      : "No candle data supplied.";

    // ---------------------------------------
    // AI PROMPT
    // ---------------------------------------

    const prompt = `
You are an institutional NSE intraday market-structure analyst.

Your job is NOT to blindly agree with the composite score.

Validate or reject the setup using:
- Price vs VWAP
- EMA 9/21 structure
- RSI
- MACD
- CPR
- ORB
- ATR
- Volume
- Last 10 candles
- Candle pattern
- Indicator agreement
- Trap risk
- Risk/reward

IMPORTANT:
The percentage values are SETUP CONFIDENCE scores.
They are NOT guaranteed probabilities of profit.

If signals conflict, prefer HOLD / NO TRADE.

========================
MARKET
========================

Symbol: ${symbol}
Price: ₹${market?.price ?? "N/A"}
Previous Signal: ${previousSignal || "None"}

Composite Bias Score:
${score}/100

========================
INDICATORS
========================

VWAP: ₹${ind?.latest?.vwap ?? "N/A"}
RSI: ${ind?.latest?.rsi ?? "N/A"}

EMA 9:
${ind?.latest?.ema9 ?? "N/A"}

EMA 21:
${ind?.latest?.ema21 ?? "N/A"}

MACD:
${ind?.latest?.macd ?? "N/A"}

MACD Signal:
${ind?.latest?.macdSignal ?? "N/A"}

ATR(14):
${ind?.latest?.atr ?? "N/A"}

CPR:
${ind?.cprState ?? "N/A"}

ORB:
${ind?.orbState ?? "N/A"}

Volume:
${market?.volume ?? "N/A"}

Relative Volume:
${market?.relativeVolume ?? "N/A"}

Volume Confirmation:
${market?.volumeConfirmed ?? "N/A"}

========================
CANDLE ENGINE
========================

Detected Pattern:
${pattern?.name || "None"}

Pattern Type:
${pattern?.type || "N/A"}

Local Candle Direction:
${candle.direction}

Local Candle Confirmation:
${candle.score}%

Detected Candle Structures:
${candle.patterns.join(", ") || "None"}

========================
LAST 10 CANDLES
========================

${candleText}

========================
LOCAL ENGINE
========================

Technical Direction:
${technical.direction}

Bullish Component Score:
${technical.bullishScore}

Bearish Component Score:
${technical.bearishScore}

Indicator Agreement:
${technical.agreement}%

Risk Quality:
${risk.riskQuality}%

Volatility Risk:
${risk.volatilityRisk}%

Trap Risk:
${risk.trapRisk}%

Setup Quality:
${risk.setupQuality}%

Preliminary Call:
${preliminaryCall}

========================
YOUR TASK
========================

Perform an independent institutional validation.

Look especially for:

1. False breakout
2. False breakdown
3. VWAP rejection
4. VWAP reclaim
5. EMA trend continuation
6. RSI exhaustion
7. MACD momentum confirmation
8. ORB failure
9. CPR rejection/support
10. Strong/weak candle follow-through
11. Volume confirmation
12. Retail chasing
13. Liquidity sweep
14. Mean-reversion conditions

Do not force a trade.

Return ONLY this structure:

FINAL CALL: BUY / SELL / HOLD / NO TRADE

CALL CONFIDENCE: XX%

CANDLE CONFIRMATION: XX%

INDICATOR AGREEMENT: XX%

TRAP RISK: XX%

RISK QUALITY: XX%

SETUP QUALITY: XX%

MARKET REGIME: TRENDING / RANGE / BREAKOUT / BREAKDOWN / HIGH VOLATILITY / UNCLEAR

ENTRY ZONE:
Give a realistic price zone.

HARD SL:
Give the structural invalidation price.

TARGET 1:
Give first target.

TARGET 2:
Give second target only if justified.

BREAKEVEN:
Explain when SL should move to entry.

WHY:
Give exactly 5 concise reasons.

CANDLE VERDICT:
Analyze the latest 2-3 candles.

TRAP:
State the most likely retail trap.

NO-TRADE CONDITION:
Give the exact condition that invalidates the setup.

EXECUTION:
One sentence describing exactly what the trader should wait for.

RULES:
- Never guarantee profit.
- Never call a weak setup strong.
- Do not recommend BUY/SELL when indicators materially conflict.
- If confidence is below 65%, prefer HOLD.
- If trap risk is above 60%, prefer NO TRADE.
- If candle confirmation is below 55%, avoid aggressive entry.
- If volume does not confirm breakout, treat breakout as suspicious.
- Prefer confirmation over prediction.
`;

    // ---------------------------------------
    // GROQ REQUEST
    // ---------------------------------------

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: MODEL,

          messages: [
            {
              role: "system",
              content:
                "You are a strict institutional NSE intraday market-structure validator. Reject low-quality setups instead of forcing trades.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],

          temperature: 0.15,

          max_tokens: 700,

          // Helps reduce unnecessary randomness.
          top_p: 0.85,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
          `Groq API Error: ${response.status} ${response.statusText}`,
      );
    }

    const aiVerdict = data?.choices?.[0]?.message?.content?.trim();

    if (!aiVerdict) {
      throw new Error("Groq returned an empty analysis.");
    }

    // ---------------------------------------
    // RESPONSE
    // ---------------------------------------

    return NextResponse.json({
      success: true,

      engine: {
        preliminaryCall,

        technicalDirection: technical.direction,

        technicalConfidence: technical.agreement,

        candleDirection: candle.direction,

        candleConfirmation: candle.score,

        indicatorAgreement: technical.agreement,

        trapRisk: risk.trapRisk,

        riskQuality: risk.riskQuality,

        volatilityRisk: risk.volatilityRisk,

        setupQuality: risk.setupQuality,

        candlePatterns: candle.patterns,
      },

      analysis: aiVerdict,

      meta: {
        model: MODEL,
        candlesAnalyzed: Math.min(
          Array.isArray(candles) ? candles.length : 0,
          10,
        ),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("AI Analyst Error:", error?.message || error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unable to generate AI analysis.",
      },
      { status: 500 },
    );
  }
}
