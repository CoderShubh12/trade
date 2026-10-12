// scripts/backtest/config.mjs
// Every assumption of the backtest is here, in one place. Change freely.

export const CONFIG = {
  timeframeMinutes: 5,

  // ---- Account & sizing (same helper the app has: lib/riskEngine.js)
  capital: 100000, // starting capital in Rs (kept fixed, profits are not compounded)
  riskPerTradePercent: 0.5, // risk per trade, % of capital
  maxLeverage: 5, // intraday margin cap

  // ---- Execution
  // Signal appears when a candle CLOSES. You can only trade after that,
  // so the trade is filled at the NEXT candle's open (plus slippage).
  slippagePercent: 0.03, // per side, against you (market / stop orders)
  slippageOnTargets: false, // target = limit order, so no slippage by default

  // ---- Data hygiene
  skipSessionIfGapPercent: 15, // overnight gap this big is probably a split/bonus, skip that day
  indicatorHistorySessions: 5, // same as the app: about 5 days of candles feed the indicators

  // ---- Honest evaluation
  inSampleShare: 0.7, // first 70% of days = in-sample, last 30% = out-of-sample
  verdict: {
    minTrades: 100, // fewer trades than this cannot prove anything
    minOutOfSampleTrades: 30,
    minProfitFactor: 1.3, // after all costs
    minExpectancyRs: 0, // average net Rs per trade must be above this
  },
};

// Charges for NSE equity INTRADAY. Rates checked on the Angel One and Zerodha
// charge pages (Oct 2026). Rates change: compare with your own contract note.
export const COSTS = {
  brokerageFlat: 20, // Angel One: lower of Rs 20 or 0.1% per executed order ...
  brokeragePercent: 0.1, // ... (percent)
  brokerageMin: 5, // ... with a minimum of Rs 5
  sttSellPercent: 0.025, // sell side only
  exchangeTxnPercent: 0.0030699, // both sides
  sebiPerCrore: 10, // Rs per crore of turnover, both sides
  ipftPercent: 0.0000001, // both sides
  stampBuyPercent: 0.003, // buy side only
  gstPercent: 18, // on brokerage + exchange + SEBI + IPFT
};
