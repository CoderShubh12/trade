// lib/scannerEngine.js
import { computeAll, calculateBollingerBands } from "./indicators";

// Chartink-style Intraday Screener Presets
export const SCANNER_STRATEGIES = {
  BULLISH_VWAP_CROSS: {
    id: "BULLISH_VWAP_CROSS",
    name: "⚡ 5M VWAP + EMA 9/21 Cross",
    description: "Close crosses above VWAP with Bullish EMA Stack & RSI > 55",
    evaluate: (candles) => {
      // Threshold lowered to 20 to support 2-hour (24 bars) intraday data
      if (!candles || candles.length < 20) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest) return false;

      const { price, vwap, ema9, ema21, rsi } = ind.latest;
      const prevClose = candles[candles.length - 2]?.close || price;

      // Rule: Current Close > VWAP, Prev Close <= VWAP, EMA9 > EMA21, RSI >= 55
      return price > vwap && prevClose <= vwap && ema9 > ema21 && rsi >= 55;
    },
  },

  ORB_BREAKOUT_VOL: {
    id: "ORB_BREAKOUT_VOL",
    name: "🚀 15M ORB High Breakout + Vol 2x",
    description:
      "Opening range breakout with volume > 1.8x of 20-period average",
    evaluate: (candles) => {
      if (!candles || candles.length < 15) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.orb || !ind?.latest) return false;

      const { price } = ind.latest;
      const currentVol = candles[candles.length - 1]?.volume || 0;
      const avgVol =
        candles.slice(-20).reduce((acc, c) => acc + (c.volume || 1), 0) /
        Math.min(candles.length, 20);

      // Rule: Price breaks ORB High with surge volume
      return price > ind.orb.high && currentVol >= avgVol * 1.8;
    },
  },

  BEARISH_BREAKDOWN: {
    id: "BEARISH_BREAKDOWN",
    name: "🔻 Institutional Short (VWAP Breakdown)",
    description: "Close breaks below Session VWAP & CPR with Bearish MACD",
    evaluate: (candles) => {
      if (!candles || candles.length < 20) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest || !ind?.cpr) return false;

      const { price, vwap, hist } = ind.latest;
      // CPR me lower band nikalne ka safe formula
      const lowerCpr = Math.min(ind.cpr.bc, ind.cpr.tc);

      // Rule: Price below VWAP & below complete CPR floor, MACD histogram negative
      return price < vwap && price < lowerCpr && hist < 0;
    },
  },

  BB_SQUEEZE_BLAST: {
    id: "BB_SQUEEZE_BLAST",
    name: "💥 Bollinger Band Squeeze Blast",
    description: "Volatility breakout after severe band contraction",
    evaluate: (candles) => {
      if (!candles || candles.length < 20) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.bb || !ind?.latest) return false;

      const closes = candles.map((c) => c.close);

      // Pichhli 3 candles me se agar kisi me squeeze tha (contraction)
      const prevCloses = closes.slice(0, -1);
      const prevBb = calculateBollingerBands(prevCloses, 20, 2);

      const hadSqueeze = prevBb.isSqueeze || ind.bb.isSqueeze;
      const isBreakingOut = ind.latest.price >= ind.bb.upper;

      return hadSqueeze && isBreakingOut;
    },
  },
};
