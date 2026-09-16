// // import { NextResponse } from "next/server";
// // import axios from "axios";
// // import { getAngelSession } from "@/lib/angelAuth";

// // const candleCache = new Map();
// // const CACHE_TTL = 120 * 1000; // 2 minutes

// // // Fallback synthetic data generator if market is closed / empty return
// // function generateOffMarketBars(symbolToken) {
// //   const basePrice =
// //     symbolToken === "26009" ? 51200 : symbolToken === "26000" ? 24950 : 2980;
// //   const bars = [];
// //   let cur = basePrice;
// //   const todayStr = new Date().toISOString().slice(0, 10);

// //   for (let i = 0; i < 60; i++) {
// //     const h = 9 + Math.floor(i / 12);
// //     const m = (i % 12) * 5;
// //     const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
// //     const delta = (Math.random() - 0.49) * (basePrice * 0.0018);
// //     const open = cur;
// //     const close = cur + delta;
// //     const high = Math.max(open, close) + Math.random() * (basePrice * 0.0008);
// //     const low = Math.min(open, close) - Math.random() * (basePrice * 0.0008);
// //     cur = close;

// //     bars.push({
// //       date: todayStr,
// //       time: timeStr,
// //       open: Number(open.toFixed(2)),
// //       high: Number(high.toFixed(2)),
// //       low: Number(low.toFixed(2)),
// //       close: Number(close.toFixed(2)),
// //       volume: Math.floor(Math.random() * 80000 + 20000),
// //     });
// //   }
// //   return bars;
// // }

// // export async function GET(request) {
// //   try {
// //     const { searchParams } = new URL(request.url);
// //     const symbolToken = searchParams.get("token") || "26000";
// //     const tf = searchParams.get("tf") || "5";
// //     const cacheKey = `${symbolToken}_${tf}`;

// //     if (candleCache.has(cacheKey)) {
// //       const entry = candleCache.get(cacheKey);
// //       if (Date.now() - entry.timestamp < CACHE_TTL) {
// //         return NextResponse.json({
// //           success: true,
// //           data: entry.data,
// //           cached: true,
// //         });
// //       }
// //     }

// //     const intervalMap = {
// //       1: "ONE_MINUTE",
// //       3: "THREE_MINUTE",
// //       5: "FIVE_MINUTE",
// //       15: "FIFTEEN_MINUTE",
// //     };
// //     const intervalStr = intervalMap[tf] || "FIVE_MINUTE";

// //     let session;
// //     try {
// //       session = await getAngelSession();
// //     } catch (e) {
// //       console.warn("Auth session error, falling back to cache/standby bars");
// //     }

// //     if (session?.jwtToken) {
// //       const curr = new Date();
// //       const pad = (n) => String(n).padStart(2, "0");
// //       const fmt = (d) =>
// //         `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// //       // Search last 7 days to cover weekends/holidays safely
// //       const past = new Date(curr.getTime() - 7 * 24 * 60 * 60 * 1000);
// //       const fromDate = `${fmt(past)} 09:15`;
// //       const toDate = `${fmt(curr)} 15:30`;

// //       try {
// //         const candleRes = await axios.post(
// //           "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
// //           {
// //             exchange: "NSE",
// //             symboltoken: symbolToken,
// //             interval: intervalStr,
// //             fromdate: fromDate,
// //             todate: toDate,
// //           },
// //           {
// //             headers: {
// //               "Content-Type": "application/json",
// //               Accept: "application/json",
// //               Authorization: `Bearer ${session.jwtToken}`,
// //               "X-UserType": "USER",
// //               "X-SourceID": "WEB",
// //               "X-ClientLocalIP": "127.0.0.1",
// //               "X-ClientPublicIP": "127.0.0.1",
// //               "X-MACAddress": "fe80::1",
// //               "X-PrivateKey": session.apiKey,
// //             },
// //             timeout: 5000,
// //           },
// //         );

// //         const rawBars = candleRes.data?.data;
// //         if (
// //           candleRes.data?.status &&
// //           Array.isArray(rawBars) &&
// //           rawBars.length > 0
// //         ) {
// //           const formattedData = rawBars.map((b) => {
// //             const ts = String(b[0]);
// //             return {
// //               date: ts.slice(0, 10),
// //               time: ts.slice(11, 16),
// //               open: Number(b[1]),
// //               high: Number(b[2]),
// //               low: Number(b[3]),
// //               close: Number(b[4]),
// //               volume: Number(b[5]) || 1,
// //             };
// //           });

// //           candleCache.set(cacheKey, {
// //             data: formattedData,
// //             timestamp: Date.now(),
// //           });
// //           return NextResponse.json({ success: true, data: formattedData });
// //         }
// //       } catch (fetchErr) {
// //         console.warn("Angel Candle API fetch failed:", fetchErr.message);
// //       }
// //     }

// //     // Safe Standby Fallback (Ensures terminal UI and indicators are 100% operational)
// //     const fallbackData =
// //       candleCache.get(cacheKey)?.data || generateOffMarketBars(symbolToken);
// //     candleCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });

// //     return NextResponse.json({
// //       success: true,
// //       data: fallbackData,
// //       fallback: true,
// //     });
// //   } catch (error) {
// //     return NextResponse.json({
// //       success: true,
// //       data: generateOffMarketBars("26000"),
// //     });
// //   }
// // }
// import { NextResponse } from "next/server";

// // 5 Stocks Config with Realistic Base Prices & Volatilities
// const STOCKS_POOL = {
//   26000: { name: "NIFTY 50", symbol: "NIFTY", basePrice: 24950, vol: 0.0006 },
//   26009: {
//     name: "BANK NIFTY",
//     symbol: "BANKNIFTY",
//     basePrice: 51200,
//     vol: 0.0008,
//   },
//   3045: {
//     name: "STATE BANK OF INDIA",
//     symbol: "SBIN",
//     basePrice: 810,
//     vol: 0.0009,
//   },
//   2885: {
//     name: "RELIANCE IND",
//     symbol: "RELIANCE",
//     basePrice: 2980,
//     vol: 0.0007,
//   },
//   1594: { name: "INFOSYS LTD", symbol: "INFY", basePrice: 1850, vol: 0.0007 },
// };

// // 2 Ghante (120 min) ka backdated Candle Generator
// function generateMockBars(token, tfMinutes = 5) {
//   const stock = STOCKS_POOL[token] || {
//     name: "CUSTOM EQUITY",
//     symbol: "STOCK",
//     basePrice: 1000,
//     vol: 0.0008,
//   };

//   const totalMinutes = 120; // 2 hours
//   const barCount = Math.max(15, Math.floor(totalMinutes / tfMinutes));
//   const bars = [];
//   let currentPrice = stock.basePrice;
//   const now = new Date();

//   for (let i = barCount - 1; i >= 0; i--) {
//     const candleTime = new Date(now.getTime() - i * tfMinutes * 60 * 1000);
//     const pad = (n) => String(n).padStart(2, "0");
//     const dateStr = `${candleTime.getFullYear()}-${pad(candleTime.getMonth() + 1)}-${pad(candleTime.getDate())}`;
//     const timeStr = `${pad(candleTime.getHours())}:${pad(candleTime.getMinutes())}`;

//     // Price dynamics
//     const delta =
//       (Math.random() - 0.49) *
//       (stock.basePrice * stock.vol * Math.sqrt(tfMinutes));
//     const open = currentPrice;
//     const close = Number((currentPrice + delta).toFixed(2));
//     const wickHigh = Math.random() * (stock.basePrice * stock.vol * 0.5);
//     const wickLow = Math.random() * (stock.basePrice * stock.vol * 0.5);

//     const high = Number((Math.max(open, close) + wickHigh).toFixed(2));
//     const low = Number((Math.min(open, close) - wickLow).toFixed(2));
//     const volume = Math.floor(Math.random() * 60000 + 10000);

//     currentPrice = close;

//     bars.push({
//       date: dateStr,
//       time: timeStr,
//       open: Number(open.toFixed(2)),
//       high,
//       low,
//       close,
//       volume,
//     });
//   }

//   return { stock, bars };
// }

// export async function GET(request) {
//   try {
//     const { searchParams } = new URL(request.url);
//     const token = searchParams.get("token") || "3045";
//     const tf = parseInt(searchParams.get("tf") || "5", 10);
//     const validTf = [1, 3, 5, 15].includes(tf) ? tf : 5;

//     const { stock, bars } = generateMockBars(token, validTf);
//     const latest = bars[bars.length - 1];

//     // Server Terminal Call Log
//     console.log(
//       `\x1b[32m[LOCAL MOCK API]\x1b[0m ${stock.symbol} | Token: ${token} | TF: ${validTf}M | Candles: ${bars.length} | LTP: ₹${latest.close} | ${latest.time}`,
//     );

//     return NextResponse.json({
//       success: true,
//       data: bars,
//       mock: true,
//     });
//   } catch (error) {
//     console.error("\x1b[31m[MOCK API ERR]\x1b[0m", error.message);
//     return NextResponse.json(
//       { success: false, error: error.message },
//       { status: 500 },
//     );
//   }
// }

// app/api/market-data/route.js
import { NextResponse } from "next/server";
import axios from "axios";
import { getAngelSession } from "@/lib/angelAuth";

// Micro-cache to prevent hitting Angel One 429 Rate Limits
const candleCache = new Map();
const CACHE_TTL_MS = 2000; // 2 seconds

const INTERVAL_MAP = {
  1: "ONE_MINUTE",
  3: "THREE_MINUTE",
  5: "FIVE_MINUTE",
  15: "FIFTEEN_MINUTE",
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolToken = searchParams.get("token") || "3045"; // Default: SBIN
    const tf = searchParams.get("tf") || "5";
    const intervalStr = INTERVAL_MAP[tf] || "FIVE_MINUTE";

    const cacheKey = `${symbolToken}_${tf}`;

    // 1. Return fresh cached response if available within 2s
    if (candleCache.has(cacheKey)) {
      const entry = candleCache.get(cacheKey);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return NextResponse.json({
          success: true,
          data: entry.data,
          cached: true,
        });
      }
    }

    // 2. Obtain Angel One SmartAPI Session
    const session = await getAngelSession();
    if (!session?.jwtToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Angel One session authorization failed. Check .env credentials.",
        },
        { status: 401 },
      );
    }

    // 3. Construct Live Market Timestamps (IST)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // Covering last 5 days safely for Monday morning / holiday sessions
    const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const fromDate = `${fmt(past)} 09:15`;
    const toDate = `${fmt(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // 4. Angel One Historical/Intraday REST API Endpoint
    const candleRes = await axios.post(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
      {
        exchange: "NSE",
        symboltoken: String(symbolToken),
        interval: intervalStr,
        fromdate: fromDate,
        todate: toDate,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${session.jwtToken}`,
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "fe80::1",
          "X-PrivateKey": session.apiKey,
        },
        timeout: 6000,
      },
    );

    const rawBars = candleRes.data?.data;

    if (
      candleRes.data?.status &&
      Array.isArray(rawBars) &&
      rawBars.length > 0
    ) {
      // Angel Output Array: [timestampStr, open, high, low, close, volume]
      const formattedData = rawBars.map((b) => {
        const ts = String(b[0]);
        return {
          time: Math.floor(new Date(ts).getTime() / 1000),
          date: ts.slice(0, 10),
          clock: ts.slice(11, 16),
          open: Number(b[1]),
          high: Number(b[2]),
          low: Number(b[3]),
          close: Number(b[4]),
          volume: Number(b[5]) || 1,
        };
      });

      // Update in-memory micro-cache
      candleCache.set(cacheKey, {
        data: formattedData,
        timestamp: Date.now(),
      });

      return NextResponse.json({
        success: true,
        data: formattedData,
        source: "ANGEL_ONE_LIVE",
      });
    }

    // If Angel One returns empty bars (e.g. illiquid stock or invalid token)
    return NextResponse.json({
      success: false,
      error:
        candleRes.data?.message || "No candle data returned from exchange.",
      data: [],
    });
  } catch (error) {
    console.error("Angel API Error:", error.response?.data || error.message);
    return NextResponse.json(
      {
        success: false,
        error: error.response?.data?.message || error.message,
        data: [],
      },
      { status: 500 },
    );
  }
}
