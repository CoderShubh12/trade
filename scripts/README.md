# Backtester (scripts folder)

Tests the app's real signal rules on past candles, with charges and slippage.
It uses the SAME engine files as the dashboard (`lib/`), so there is no second
copy of the rules to go out of date.

## 1. Download history (needs Angel One login, works when the market is closed)

    npm run history                       # 15 stocks from lib/stockPool.js + Nifty, 90 days, 5 min
    npm run history -- --days 180 --limit 30
    npm run history -- --symbols SBIN,ONGC,TATASTEEL

Saved to `data/history/`. The script removes duplicates, removes candles outside
09:15-15:30, and warns about days with missing candles.
Tip: run it again later to refresh; it overwrites the files.

## 2. Run the backtest

    npm run backtest
    npm run backtest -- --risk 0.5 --slippage 0.05 --from 2026-06-01
    npm run backtest -- --symbols SBIN,ONGC

Results go to `backtest-results/<date-time>/`:
- `report.md`  the readable report (verdict first)
- `trades.csv` every trade (open in Excel)
- `summary.json` the numbers

## How to read the verdict

PASS needs ALL of: at least 100 trades, average result per trade above zero,
profit factor 1.3 or more, after all charges, on all days AND on the last 30% of
days (out-of-sample), which are never used to tune anything.
Anything less prints "DOES NOT PASS" with the reasons.
Change the thresholds and every assumption in `scripts/backtest/config.mjs`.

## Important

- Do NOT tune the rules until the numbers look good on the same days you judge them on.
  That fits noise. Tune on the in-sample part, then check the out-of-sample part once.
- A pass is a reason to paper-trade, not a promise of profit.
- Charges are for Angel One style intraday equity; compare with your contract note.
