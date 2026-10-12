# Backtest report

Generated: 2026-10-10T19:28:16.278Z  
Stocks: 15 | Days: 2026-07-13 to 2026-10-09 (62 trading days) | Candles: 5 minute

## Verdict: DOES NOT PASS

- average net result per trade is Rs -146.03 (must be above Rs 0)
- net profit factor 0.33 is below 1.3
- out-of-sample average is Rs -123.64 per trade (must be above Rs 0)
- out-of-sample profit factor 0.42 is below 1.3

A backtest only describes the past. A pass here is a reason to paper-trade, never a promise of profit.

## Results (all figures are AFTER charges and slippage)

| Period | Trades | Win rate | Net P&L | Avg per trade | Profit factor | Max drawdown | Sharpe |
|---|---|---|---|---|---|---|---|
| All days | 2174 | 27.6% | Rs -3,17,479.15 | Rs -146.03 | 0.33 | Rs 3,17,479.15 (317.5%) | -31.06 |
| In-sample (2026-07-14 to 2026-09-10) | 1494 | 25.3% | Rs -2,33,401.24 | Rs -156.23 | 0.29 | Rs 2,33,654.12 (233.7%) | -33.44 |
| Out-of-sample (2026-09-11 to 2026-10-09) | 680 | 32.5% | Rs -84,077.91 | Rs -123.64 | 0.42 | Rs 84,077.91 (84.1%) | -26.58 |

Before charges (slippage already included) the same trades made Rs -1,36,099.68; charges took Rs 1,81,379.25. Average winner Rs 257.98, average loser Rs -299.69, average hold 26.3 min. Profit factor before charges: 0.61.

### By exit reason

| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |
|---|---|---|---|---|---|
| MARKET_CLOSE_SQUAREOFF | 19 | 36.8% | Rs -707.96 | Rs -37.26 | 0.69 |
| STOP_LOSS_HIT | 199 | 0% | Rs -1,26,949.97 | Rs -637.94 | 0 |
| TARGET_2_HIT | 19 | 100% | Rs 25,621.66 | Rs 1,348.51 | - |
| TIME_DECAY_TIMEOUT | 1635 | 35% | Rs -98,116.69 | Rs -60.01 | 0.56 |
| TRAILING_SL_HIT | 4 | 0% | Rs -51.46 | Rs -12.87 | 0 |
| VWAP_BREACH_EXIT | 298 | 0% | Rs -1,17,274.73 | Rs -393.54 | 0 |

### By side

| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |
|---|---|---|---|---|---|
| BUY | 894 | 25.1% | Rs -1,48,606.7 | Rs -166.23 | 0.32 |
| SELL | 1280 | 29.3% | Rs -1,68,872.45 | Rs -131.93 | 0.33 |

### By entry hour (IST)

| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |
|---|---|---|---|---|---|
| 09h | 643 | 26.6% | Rs -1,10,777.58 | Rs -172.28 | 0.31 |
| 10h | 515 | 29.5% | Rs -74,722.78 | Rs -145.09 | 0.36 |
| 11h | 295 | 30.2% | Rs -40,525.15 | Rs -137.37 | 0.33 |
| 13h | 446 | 27.1% | Rs -50,017.62 | Rs -112.15 | 0.36 |
| 14h | 275 | 24% | Rs -41,436.02 | Rs -150.68 | 0.26 |

### By month

| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |
|---|---|---|---|---|---|
| 2026-07 | 497 | 25.2% | Rs -80,904.65 | Rs -162.79 | 0.27 |
| 2026-08 | 709 | 24.5% | Rs -1,09,946.63 | Rs -155.07 | 0.27 |
| 2026-09 | 751 | 29.2% | Rs -1,04,578.83 | Rs -139.25 | 0.37 |
| 2026-10 | 217 | 37.3% | Rs -22,049.04 | Rs -101.61 | 0.52 |

### By stock (worst and best)

| Group | Trades | Win rate | Net P&L | Avg per trade | Profit factor |
|---|---|---|---|---|---|
| CANBK | 149 | 24.2% | Rs -28,223.93 | Rs -189.42 | 0.2 |
| FEDERALBNK | 146 | 25.3% | Rs -25,617.53 | Rs -175.46 | 0.22 |
| BHEL | 156 | 32.1% | Rs -24,625.04 | Rs -157.85 | 0.33 |
| PNB | 149 | 22.1% | Rs -24,359.95 | Rs -163.49 | 0.28 |
| BANKBARODA | 160 | 29.4% | Rs -23,660.3 | Rs -147.88 | 0.4 |
| SAIL | 143 | 30.1% | Rs -18,551.23 | Rs -129.73 | 0.49 |
| IOC | 137 | 25.5% | Rs -18,131.59 | Rs -132.35 | 0.25 |
| IDFCFIRSTB | 142 | 27.5% | Rs -17,085.89 | Rs -120.32 | 0.34 |
| TATASTEEL | 148 | 30.4% | Rs -16,752.86 | Rs -113.19 | 0.48 |
| GAIL | 130 | 30.8% | Rs -16,317.96 | Rs -125.52 | 0.36 |

## What was assumed

- Starting capital Rs 1,00,000, fixed (profits not compounded). Risk per trade 0.5% of capital, max leverage 5x.
- A signal appears when a candle closes. The trade is filled at the NEXT candle's open, plus slippage 0.03% per side against you. Target exits get no slippage: limit order assumption.
- Inside a candle the worst order is assumed (the move against you happens first). Stop-loss and targets are tested on candle high/low; VWAP break, 25-minute time-out and the 3:15 PM square-off are tested on the close.
- Charges: Angel One style intraday equity: brokerage lower of Rs 20 or 0.1% (min Rs 5) per order, STT 0.025% on sell, exchange 0.0030699%, SEBI Rs 10/crore, stamp 0.003% on buy, GST 18%. Compare with your contract note.
- The entry rules are exactly the app's rules (same files). The 25-minute limit is counted from the signal candle.
- Nifty filter: applied (Nifty history was available).

## Known limits of this test

- **Survivorship / selection bias:** the stock list is today's list, picked by today's price bands. Stocks that fell out of favour are missing, which flatters results.
- **Corporate actions:** candles may not be adjusted for splits and bonuses. Days with an overnight gap above 15% are skipped as a precaution.
- **Trades are independent per stock:** all stocks are traded at the same time with the same capital each, so real capital use on busy days would be higher than the account size.
- **Fills are simulated:** real markets can have wider spreads, rejected orders and partial fills, especially in volatile moments.
