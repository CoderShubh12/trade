import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

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
    } = body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: "Gemini API key missing in .env.local",
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are a senior institutional derivatives desk trader and quantitative analyst specializing in NSE Indian Equities and F&O.
Analyze the following multi-timeframe live market state for ${symbol}:

[CURRENT MARKET TELEMETRY]
- Spot LTP: ₹${price}
- Session VWAP: ₹${vwap} (Stretch: ${(price - vwap).toFixed(2)})
- Composite Bias Score (-100 to +100): ${biasScore}
- EMA 9 / 21 Trend: ${trend}
- RSI (14 Period): ${rsi}
- CPR Placement: ${cprState || "Neutral CPR zone"}
- 30-Min Opening Range (ORB): ${orbState}
- Volatility ATR (14): ₹${atr || "Dynamic"}

Deliver a deep, institutional-grade intraday trade thesis with exactly these 4 clearly titled sections. Do not use generic disclaimers.

1. MARKET STRUCTURE & ORDER FLOW:
Explain who controls the auction right now (Bulls vs Bears). Analyze price relative to VWAP and CPR, volume conviction, and whether the market is in a trend day or mean-reverting chop.

2. INSTITUTIONAL TRAP DETECTION:
Pinpoint where retail traders are likely to get trapped right now (e.g., chasing false breakout/breakdown, buying into high RSI exhaustion, or selling against virgin CPR support).

3. PRECISE EXECUTION STRATEGY:
State the exact tactical play (Pullback to VWAP / Breakout Confirmation / Wait for Range Sweep). Detail the optimal entry zone, invalidation level (Hard SL), and primary institutional liquidity target.

4. TRAILING & RISK MANAGEMENT:
Provide specific guidance on when to shift Stop Loss to cost (breakeven) and how to manage position sizing given current ATR.
`;

    const candidateModels = ["gemini-3.6-flash", "gemini-2.5-flash"];
    let lastError = null;

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.25,
            maxOutputTokens: 900,
          },
        });

        if (response?.text) {
          return NextResponse.json({ success: true, insight: response.text });
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    return NextResponse.json({
      success: false,
      error: lastError || "Unable to generate analysis.",
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 },
    );
  }
}
