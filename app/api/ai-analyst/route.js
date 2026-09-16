// app/api/ai-analyst/route.js
import { NextResponse } from "next/server";
import Groq from "groq-sdk";

const MODEL = "openai/gpt-oss-120b";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

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
        if (pc < po && cl > o && o <= pc && cl >= po) {
          bullish += 15;
          patterns.push("Bullish Engulfing");
        }
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
  const price = num(market.price ?? latest.price);
  const vwap = num(latest.vwap);

  // 1. Composite Bias
  if (bias >= 65) bull += 25;
  else if (bias >= 45) bull += 12;
  else if (bias <= -65) bear += 25;
  else if (bias <= -45) bear += 12;

  // 2. EMA Structure
  const ema9 = num(latest.ema9);
  const ema21 = num(latest.ema21);
  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) bull += 15;
    if (ema9 < ema21) bear += 15;
  }

  // 3. VWAP
  if (price !== null && vwap !== null) {
    if (price > vwap) bull += 12;
    if (price < vwap) bear += 12;
  }

  // 4. RSI
  if (rsi !== null) {
    if (rsi >= 55 && rsi <= 70) bull += 10;
    if (rsi >= 30 && rsi <= 45) bear += 10;
    if (rsi > 75) bull -= 6;
    if (rsi < 25) bear -= 6;
  }

  // 5. MACD
  const hist = num(latest.hist ?? latest.macd);
  if (hist !== null) {
    if (hist > 0) bull += 10;
    if (hist < 0) bear += 10;
  }

  // 6. CPR
  const cpr = String(ind?.cprState || "").toLowerCase();
  if (cpr.includes("bull") || cpr.includes("above")) bull += 8;
  if (cpr.includes("bear") || cpr.includes("below")) bear += 8;

  // 7. ORB
  const orb = String(ind?.orbState || "").toLowerCase();
  if (orb.includes("breakout") || orb.includes("above")) bull += 8;
  if (orb.includes("breakdown") || orb.includes("below")) bear += 8;

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
  const price = num(body?.market?.price ?? latest?.price);
  const atr = num(latest?.atr ?? body?.atr);

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
  if (rsi !== null && (rsi > 75 || rsi < 25)) trapRisk += 20;
  if (candle.patterns.includes("Doji / Indecision")) trapRisk += 12;
  if (technical.agreement < 60) trapRisk += 20;
  if (body?.market?.volumeConfirmed === false) trapRisk += 15;

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
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { success: false, error: "GROQ_API_KEY is missing in .env.local" },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      symbol = "UNKNOWN",
      score = 0,
      ind = {},
      pattern = {},
      candles = [],
      market = {},
      previousSignal = null,
      timeframe = "5",
    } = body;

    // 1. Run deterministic engines
    const candle = candleAnalysis(candles);
    const technical = technicalEngine({ score, ind, market });
    const risk = riskEngine({ ...body, candles }, candle, technical);

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

    const candleText =
      Array.isArray(candles) && candles.length > 0
        ? candles
            .slice(-8)
            .map(
              (c, i) =>
                `${i + 1}. O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? 0}`,
            )
            .join("\n")
        : "No candles available";

    const prompt = `
You are an institutional NSE intraday market-structure validator. Validate or veto this setup.

Symbol: ${symbol} | TF: ${timeframe}M | Price: ₹${market?.price ?? ind?.latest?.price ?? "N/A"}
Composite Score: ${score}/100 | Setup Side: ${technical.direction}
VWAP: ₹${ind?.latest?.vwap ?? "N/A"} | RSI: ${ind?.latest?.rsi ?? "N/A"}
EMA 9: ${ind?.latest?.ema9 ?? "N/A"} | EMA 21: ${ind?.latest?.ema21 ?? "N/A"}
CPR: ${ind?.cprState ?? "N/A"} | ORB: ${ind?.orbState ?? "N/A"}
Detected Pattern: ${pattern?.name || candle.patterns.join(", ") || "None"}

Preliminary Call: ${preliminaryCall}
Technical Agreement: ${technical.agreement}% | Risk Quality: ${risk.riskQuality}% | Trap Risk: ${risk.trapRisk}%

Recent Candles:
${candleText}

Return your response strictly as valid, raw JSON with this exact structure:
{
  "recommendation": "BUY" | "SELL" | "HOLD" | "NO TRADE",
  "confidenceScore": number (0-100),
  "timeframeValidity": "string (e.g. Next 1-2 candles (5-10m))",
  "biasReason": "string (max 18 words explaining technical root cause)",
  "tradePlan": {
    "idealEntry": number,
    "target": number,
    "stopLoss": number,
    "riskRewardRatio": "string"
  },
  "riskWarning": "string (max 14 words detailing trap/invalidation)",
  "detailedAnalysis": "string (3-4 sentences on market structure and wick behavior)"
}`;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a strict institutional quantitative intraday analyst for NSE. Always respond in valid JSON format only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.15,
      response_format: { type: "json_object" },
    });

    const parsedData = JSON.parse(
      completion.choices[0]?.message?.content || "{}",
    );

    return NextResponse.json({
      success: true,
      data: parsedData,
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
