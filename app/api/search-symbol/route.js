import { NextResponse } from "next/server";
import axios from "axios";

let nseMasterList = null;
let lastFetchTime = 0;
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // Cache for 24 hours

// Angel One official OpenScrip master database
async function getNSEMaster() {
  const now = Date.now();
  if (nseMasterList && now - lastFetchTime < REFRESH_INTERVAL) {
    return nseMasterList;
  }

  try {
    const res = await axios.get(
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json",
      { timeout: 15000 },
    );

    if (Array.isArray(res.data)) {
      // Filter only active NSE Equity shares (series EQ) and core benchmark indices
      nseMasterList = res.data
        .filter(
          (item) =>
            item.exch_seg === "NSE" &&
            (item.symbol?.endsWith("-EQ") || item.instrumenttype === "AMXIDX"),
        )
        .map((item) => ({
          symbol: item.name || item.symbol.replace("-EQ", ""),
          fullSymbol: item.symbol,
          name: item.symbol,
          token: item.token,
          exchangeSegment: 1, // 1 for NSE
        }));

      lastFetchTime = now;
      return nseMasterList;
    }
  } catch (err) {
    console.error("Failed to download Angel scrip master:", err.message);
  }

  return [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().toUpperCase();

  if (!q || q.length < 2) {
    return NextResponse.json({ success: true, results: [] });
  }

  const master = await getNSEMaster();

  // Instant fuzzy filter top 15 matches
  const matches = master
    .filter((item) => item.symbol.includes(q) || item.fullSymbol.includes(q))
    .slice(0, 15);

  return NextResponse.json({ success: true, results: matches });
}
