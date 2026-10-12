// scripts/backtest/costs.mjs
// Turns one finished trade into its exact Indian intraday charges (in Rs).

import { COSTS } from "./config.mjs";

function brokerageForOrder(turnover) {
  const percentCharge = (COSTS.brokeragePercent / 100) * turnover;
  return Math.max(COSTS.brokerageMin, Math.min(COSTS.brokerageFlat, percentCharge));
}

// qty shares, bought at buyPrice and sold at sellPrice (works for shorts too:
// a short trade simply sells first and buys later).
export function tradeCharges(qty, buyPrice, sellPrice) {
  const buyTurnover = qty * buyPrice;
  const sellTurnover = qty * sellPrice;
  const totalTurnover = buyTurnover + sellTurnover;

  const brokerage =
    brokerageForOrder(buyTurnover) + brokerageForOrder(sellTurnover);
  const stt = (COSTS.sttSellPercent / 100) * sellTurnover;
  const exchange = (COSTS.exchangeTxnPercent / 100) * totalTurnover;
  const sebi = (COSTS.sebiPerCrore / 1e7) * totalTurnover;
  const ipft = (COSTS.ipftPercent / 100) * totalTurnover;
  const stamp = (COSTS.stampBuyPercent / 100) * buyTurnover;
  const gst = (COSTS.gstPercent / 100) * (brokerage + exchange + sebi + ipft);

  const total = brokerage + stt + exchange + sebi + ipft + stamp + gst;
  return { brokerage, stt, exchange, sebi, ipft, stamp, gst, total };
}
