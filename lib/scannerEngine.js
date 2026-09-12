// lib/scannerEngine.js
import { computeAll } from "./indicators";

// Chartink-style Intraday Screener Presets
export const SCANNER_STRATEGIES = {
  BULLISH_VWAP_CROSS: {
    id: "BULLISH_VWAP_CROSS",
    name: "⚡ 5M VWAP + EMA 9/21 Cross",
    description: "Close crosses above VWAP with Bullish EMA Stack & RSI > 55",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest) return false;

      const { price, vwap, ema9, ema21, rsi } = ind.latest;
      const prev = candles[candles.length - 2];

      // Rule: Current Close > VWAP, Prev Close <= VWAP, EMA9 > EMA21, RSI > 55
      return price > vwap && prev.close <= vwap && ema9 > ema21 && rsi >= 55;
    },
  },

  ORB_BREAKOUT_VOL: {
    id: "ORB_BREAKOUT_VOL",
    name: "🚀 15M ORB High Breakout + Vol 2x",
    description: "Opening range breakout with volume > 2x of 20-period average",
    evaluate: (candles) => {
      if (!candles || candles.length < 15) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.orb || !ind?.latest) return false;

      const { price } = ind.latest;
      const currentVol = candles[candles.length - 1]?.volume || 0;
      const avgVol =
        candles.slice(-20).reduce((acc, c) => acc + (c.volume || 1), 0) / 20;

      // Rule: Price breaks Day High/ORB High with high relative volume
      return price > ind.orb.high && currentVol >= avgVol * 2.0;
    },
  },

  BEARISH_BREAKDOWN: {
    id: "BEARISH_BREAKDOWN",
    name: "🔻 Institutional Short (VWAP Breakdown)",
    description: "Close breaks below Session VWAP & CPR with Bearish MACD",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest || !ind?.cpr) return false;

      const { price, vwap, hist } = ind.latest;
      // Rule: Price below VWAP & Bottom Central Pivot (BC), MACD Hist negative
      return price < vwap && price < ind.cpr.bc && hist < 0;
    },
  },

  BB_SQUEEZE_BLAST: {
    id: "BB_SQUEEZE_BLAST",
    name: "💥 Bollinger Band Squeeze Blast",
    description: "Volatility breakout after severe band contraction",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.bb || !ind?.latest) return false;

      // Rule: Band was in squeeze and price closing outside the Upper Band
      return ind.bb.isSqueeze && ind.latest.price > ind.bb.upper;
    },
  },
};
