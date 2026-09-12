// app/api/screener/route.js
import { NextResponse } from "next/server";
import { STOCK_POOL } from "@/lib/stockPool";
import { SCANNER_STRATEGIES } from "@/lib/scannerEngine";

export async function POST(req) {
  try {
    const { strategyId } = await req.json();
    const strategy = SCANNER_STRATEGIES[strategyId];

    if (!strategy) {
      return NextResponse.json(
        { success: false, error: "Invalid Strategy" },
        { status: 400 },
      );
    }

    // टॉप लिक्विड स्टॉक्स के सैंपल पूल को तेजी से चेक करना
    const matchedStocks = [];
    const poolSubset = STOCK_POOL.slice(0, 30); // परफॉरमेंस के लिए टॉप 30 सक्रिय स्टॉक्स

    for (const stock of poolSubset) {
      try {
        // इंटरनल मार्केट डेटा API से 5M डेटा लेना
        const res = await fetch(
          `http://localhost:3000/api/market-data?token=${stock.token}&tf=5`,
          { cache: "no-store" },
        );
        const json = await res.json();

        if (json.success && json.data?.length > 25) {
          const isMatch = strategy.evaluate(json.data);
          if (isMatch) {
            const lastCandle = json.data[json.data.length - 1];
            matchedStocks.push({
              symbol: stock.symbol,
              token: stock.token,
              exchangeSegment: stock.segment || 1,
              price: lastCandle.close,
              volume: lastCandle.volume,
            });
          }
        }
      } catch (err) {
        // Skip individual errors to maintain speed
      }
    }

    return NextResponse.json({
      success: true,
      strategy: strategy.name,
      count: matchedStocks.length,
      results: matchedStocks,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
