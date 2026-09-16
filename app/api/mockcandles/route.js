import { NextResponse } from "next/server";

// 5 Supported Stocks / Indices with base prices & volatility
const STOCKS_CONFIG = {
  26000: {
    name: "NIFTY 50",
    symbol: "NIFTY",
    basePrice: 24950,
    volatility: 0.0006,
  },
  26009: {
    name: "BANK NIFTY",
    symbol: "BANKNIFTY",
    basePrice: 51200,
    volatility: 0.0008,
  },
  2885: {
    name: "RELIANCE",
    symbol: "RELIANCE",
    basePrice: 2980,
    volatility: 0.0007,
  },
  1594: {
    name: "INFOSYS",
    symbol: "INFY",
    basePrice: 1850,
    volatility: 0.0007,
  },
  3045: {
    name: "STATE BANK OF INDIA",
    symbol: "SBIN",
    basePrice: 810,
    volatility: 0.0009,
  },
};

function generateTwoHourData(token, tfMinutes) {
  const stock = STOCKS_CONFIG[token] || STOCKS_CONFIG["26000"];
  const totalMinutes = 120; // 2 hours window
  const barCount = Math.floor(totalMinutes / tfMinutes);

  const bars = [];
  let currentPrice = stock.basePrice;
  const now = new Date();

  for (let i = barCount - 1; i >= 0; i--) {
    // Timestamp calculated backwards from current time
    const candleTime = new Date(now.getTime() - i * tfMinutes * 60 * 1000);

    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${candleTime.getFullYear()}-${pad(candleTime.getMonth() + 1)}-${pad(candleTime.getDate())}`;
    const timeStr = `${pad(candleTime.getHours())}:${pad(candleTime.getMinutes())}`;

    // Realistic price movements
    const change =
      (Math.random() - 0.49) *
      (stock.basePrice * stock.volatility * Math.sqrt(tfMinutes));
    const open = currentPrice;
    const close = Number((open + change).toFixed(2));
    const wick1 = Math.random() * (stock.basePrice * stock.volatility * 0.5);
    const wick2 = Math.random() * (stock.basePrice * stock.volatility * 0.5);

    const high = Number((Math.max(open, close) + wick1).toFixed(2));
    const low = Number((Math.min(open, close) - wick2).toFixed(2));
    const volume = Math.floor(Math.random() * 45000 + 5000);

    currentPrice = close;

    bars.push({
      date: dateStr,
      time: timeStr,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return { stock, bars };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token") || "26000";
    const tf = parseInt(searchParams.get("tf") || "5", 10);

    // Validate timeframe
    const validTf = [1, 3, 5, 15].includes(tf) ? tf : 5;

    const { stock, bars } = generateTwoHourData(token, validTf);

    return NextResponse.json({
      success: true,
      token,
      stockName: stock.name,
      symbol: stock.symbol,
      timeframe: `${validTf}m`,
      totalBars: bars.length,
      data: bars,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }
}
