# NSE Terminal – Implementation Notes (saved 2026-10-12)

Rules that apply to everything below
- Paper trading only. No automatic live orders.
- Real data only. Never mix live, replay, mock and historical.
- A change goes live ONLY if it improves OUT-OF-SAMPLE results after costs (70/30 chronological split; PF >= 1.3 and positive net per trade on both halves, >= 100 trades).
- Every filter sits behind an on/off flag so today's tested version can be restored instantly.
- Broker credentials stay server-side. Login comes from .env.local.

## Done (deployed on the user's machine)
- Replay mode, repeated-call fix, big chart, watchlist (server file), fundamentals (Yahoo), trade log.
- Backtester with costs + 70/30 split; daily backtester; movers/dependency analysis; ML walk-forward test (no edge found).
- Security: env-based login, signed session cookie, all /api/* protected, login rate limit.
- Order-book recorder: `npm run record` (data/depth). Layout NOT yet verified on live packets.
- Paper journal: data/paper-journal.json, net-after-costs stats in LOG tab, CSV download.

## Monday 12 Oct – live checks (do first)
1. Start `npm run dev` before 09:15 IST, log in, LIVE mode.
2. Confirm SBIN price ticks and candles fill.
3. After the first call exits, confirm the journal box updates.
4. Optional: `npm run record` in a second window; check rows/rejected counts in the first 2 minutes.
5. Send any terminal error line to Claude.

## To implement (priority order)
1. Re-link computer; run BASELINE (current engine, 70/30 split; best so far PF 0.70 out-of-sample).
2. Cost-aware filter: skip setups whose expected move (ATR to target) < 3x round-trip cost.
3. Time-of-day map: measure each window, block the ones that lose.
4. Day-type classifier (trend vs range from first 30 min); skip range days.
5. Multi-timeframe: 15m trend, 5m confirmation, 1m entry; reject strong conflicts.
6. Regime label: strong up/down, sideways, high-vol, low-volume, breakout/breakdown; disable strategies that fail in the current regime.
7. Trap / false-breakout checks: low-volume breakout, volume spike without follow-through, repeated rejection at a level -> NO TRADE.
8. Stocks-in-play list before open (gap, relative volume, previous range); trade only the top 5-10.
9. Entry quality model on candidates (walk-forward, calibrated, can only REJECT). Uncertainty + data-quality flags.
10. Exact signal output: instrument, BUY/SELL/NO TRADE, setup, entry zone, stop, targets, P(target before stop) only if validated, expected net R:R, fees+slippage, confirmations, rejection reasons, expiry, invalidation, model uncertainty, paper status.
11. Performance monitoring split by regime, instrument, strategy, time of day, long vs short; flag deteriorating strategies; no auto-retrain on live outcomes.
12. Event-risk flag: scheduled events (RBI, expiry, budget, results) when known; show "no data" otherwise.
13. Risk guard: daily loss limit, stop after 3 losses in a row, rule-break tags in the journal.

## Ideas to test (need existing data)
- Swing holds 3-10 days (52-week-high, weekly momentum rotation, Nifty trend filter).
- Gap behaviour on daily data; sector relative strength; expiry-day behaviour.

## Ideas that need NEW data
- Order-book imbalance (recorder, 2-3 weeks of data).
- Futures open interest with price; India VIX regime; delivery % and bulk/block deals; earnings drift (needs earnings dates).

## Known caveats / open items
- Implied index weights are estimates, not official NSE weights.
- Stock list has survivorship bias.
- Yahoo fundamentals are an unofficial feed.
- Angel depth packet layout unverified until a live run.
- REPLAY checks stops/targets only at candle closes.
- /api/ws-token sends the feedToken to the browser; unused server.js snippet and zip/build script still need review.
- Old components/CallWatchlist.jsx is unused.
- All tests so far: no intraday edge after costs. Do not trade real money without >= 100 paper trades with PF >= 1.3.

## Tonight (after market) - agreed 2026-10-12
1. Server-side trade monitor: exits recorded without the browser tab (open SELL SBIN 09:45 has no exit).
2. News + event risk with Groq: pull real headlines per stock/market, Groq only summarises/tags sentiment and event risk (never invents a price or signal); show "no data" when no news; used as a flag/reject filter only.
3. Fundamentals: Yahoo tab exists (unofficial feed); wire it into the pre-market stocks-in-play list as a flag, not a signal.
4. Vercel: IST fix for Angel date range (done in code, needs push); stale-data badge; journal needs a database on Vercel.
5. Fix list: single signal source, remove zero-volume -> 1 candle conversion, cost/time/day-type/MTF filters tested on history, remove unused code, rotate old passwords.

## Test results 2026-10-12 (offline, 44 stocks, 63 days of 5m, costs included)
- analysis/ml_rejector.py: breakout candidates PF 0.31 (-0.71R/trade); ML keeps only 3-18 trades, no edge -> FAIL.
- analysis/setup_search.py: ORB / EMA pullback / VWAP-fade x stops x time window x cost filter, 66 configs: best TRAIN PF 0.72; TEST median PF 0.61, 0% of configs PF>=1.3 -> FAIL. No intraday 5m rule tested so far survives costs.
- Next to test: daily/swing (3-10 day) ideas, 15m/hourly timeframes with wider targets, longer history (only 63 days now), sector/index-relative strength.
- setup_search.py 15 (15m bars, 114 configs): best TRAIN PF 0.63; TEST median PF 0.51, 0% >= 1.3 -> FAIL. 15m is no better than 5m.
- analysis/in_play.py (gap + opening volume "stocks in play", follow/fade, hold to 15:15, OR stop): only 13-35 test trades per config, train/test results flip sign (fade train PF 2-2.8 -> test 0.1; fade-no-stop train ~1.0 -> test 1.3-1.7). Pure noise at this sample size -> FAIL / INCONCLUSIVE. Needs far more history (6-12 months) before any conclusion.
- DONE 2026-10-12: /api/news (Google News RSS headlines -> Groq tags sentiment + eventRisk, 10-min cache, "no data" fallback). Stored per call in journal `feat` (newsSent, eventRisk) as ML features. Shadow only. Headlines include some generic quote-page noise; filter later. Use only as a reject flag after validation on >=100 trades.

## Faults found in 2026-10-12 live tests (15-min checks)
FIXED: Vercel UTC date range (IST fix in code, needs push); candle API 403 storms (cache 12s, gap 0.7s, escalating pause 10-60s); journal duplicate call (server dedupe); feat.mins UTC->IST; journal timeframe+feat+news tag.
OPEN: exit missing when tab closed (SELL SBIN 09:45 hit T1 11:00, not recorded) -> server-side trade monitor; CHOPPY_SIDEWAYS regime still fires calls; candle API fails 4/4 for uncached stock during Angel cooldown -> chart blank (need tick-built candles / queue); LTP first request returns stale tick (ageMs 40 min); double-fire of the same call 17ms apart (probably double effect); zero-volume candle -> 1; Vercel needs DB + Angel IP; stale badge on screen; scanning many stocks trips Angel limit (one account shared with Vercel tab).
- DONE 2026-10-12 evening: server-side exit reconcile (lib/journalReconcile.js, runs from GET /api/journal, throttled 2 min). Only for past days or after 15:35 IST; uses real 5m candles, initial SL + T1 (no trailing), stop checked first, tagged source:"server". Journal rows now also store `token`. Tested: SELL SBIN 09:45 -> T1_SERVER 940.07 at 11:00, +1.67R. Still open: live (during market) server-side monitor, regime filter, tick-built candles.
- DONE 2026-10-14: closing-stub candle (zero volume, flat) dropped in market-data; liveFeed returns fresh tick on first request for a token (was returning old tick); app/api/mockcandles moved to _unused/ (served fake candles dated today; no references). Decision left to user: Nifty bias uses change from today's OPEN (not previous close) - changing it alters signals, so only after a tested comparison.
- DONE 2026-10-14 (untested live, market was closed): SERVER ENGINE (lib/serverEngine.js, /api/engine). Same rules as dashboard (buildCompositeScore, evaluateTradeSetup, monitorActiveTrade incl. T1->cost, VWAP breach, 25-min timeout, 15:15 square-off), watchlist first 6 stocks, once per closed 5m candle, ticks via liveFeed, journal via lib/journalStore.js (locked writes). OFF unless SERVER_ENGINE=1 in .env.local. Limits: -3R/day or 3 losses in a row stops new calls; 45-min cooldown after a loss. Page skips its own journaling when engine is on. TODO: Telegram alerts, start engine at boot (instrumentation), news feat, live test on first market day, regime filter.


## 2026-10-18 02:55 IST - Safety bots run 1 + chart patterns
- lib/chartPatterns.js (new): double top/bottom, head & shoulders (+inverse), triangles (asc/desc/sym), bull/bear flag, box breakout, inside-bar breakout. Fires only on the first closed bar beyond the trigger level; pivots need 3 confirming bars (no look-ahead). Unit cases in analysis/pattern_unit.mjs (all pass).
- analysis/pattern_test.mjs on 44 stocks, 63 days of 5m data, 190,324 bars, 6,589 pattern signals, costs + 0.03% slippage, 70/30 split:
  every pattern FAILS (ALL PATTERNS PF 0.24, net -0.60R/trade; test half PF 0.28). The REVERSED direction of the same signals is just as bad (PF 0.25, -0.57R): the patterns carry no directional information here; most of the loss is cost drag (about -0.4 to -0.5R per trade at Rs 500 risk and 1.2 ATR stops). Patterns stay DISPLAY-ONLY (not wired into any call). Full table: analysis/pattern_results.txt.
- Takeaway: with 1.2 ATR stops and these costs, a 5m intraday trade starts about -0.5R behind. Any future setup must beat that, so wider stops / fewer trades are the first things to test, not more patterns.
- lib/safetyBots.js (new): Journal Backup Bot (data/backups, throttled snapshot after journal writes, one per IST day, keeps newest 40, refuses to back up a corrupt file) and Journal Integrity Bot (duplicate ids/calls, illogical levels, exit before entry, R mismatch, stale open trades). GET /api/health shows both. 15/15 unit tests pass (analysis/safety_unit.mjs). Verified live on localhost: /api/health ok, 2 rows, 0 errors, 2 warnings (old rows without token).
- Run 5, /autopsy page + /api/autopsy: closed journal trades are replayed on that day's 5m candles (recorded history, else last 5 days from the candle feed) with a chart (entry/stop/T1/exit/VWAP) and a plain explanation; top section shows the multi-stock loss causes; 8 replayed example trades (one per cause) are shown labelled as simulation. The 2 journal trades of 12 Oct are listed as "not explained yet": no candles recorded for that day (re-run fetch-movers after a market day).
- Run 6, Self-Test Bot: `npm run selftest` (node scripts/selftest.mjs, offline, 23 tests): IST helper, trade windows, every exit rule (stop, T1->cost, T2, 25-min time stop, 15:15 square-off, VWAP breach, BUY and SELL), entry rules + Nifty bias, signal memory (re-arm, cooldown, max 3/day), composite-score sanity, journal dedupe + parallel writes (in a temp folder, real data untouched), integrity checker, health rules, chart-pattern look-ahead, autopsy classification. All pass; a deliberately broken copy fails as it should. No real bug found in these paths.
- Run 7, Exposure Guard Bot (lib/safetyBots.js checkExposure + EXPOSURE constants, used in lib/serverEngine.js evaluate() before a NEW call is recorded; exits/monitoring are never gated): max 2 open paper trades, max 2 in one direction, no new call on a stock whose last 3 calls today were losses (per-stock results kept in engine state `hist`), no call against Nifty beyond a bias score of +/-25 (score = Nifty % from today's open x 50, so 0.5%), max 6 new calls per day. Blocks are logged in the engine notes (once per reason) and the setup stays armed. Note: evaluateTradeSetup already refuses a call against a Nifty move beyond +/-0.2%, which is stricter than this guard, so the Nifty rule only matters if that rule is ever loosened. 28/28 selftest pass (5 new exposure tests, incl. a check that the guard sits before recordEntry). Not tested live: the engine has still never run in a market session. These are paper-trading safety limits, not an edge.

## 2026-10-18 morning checklist and status (end of the overnight build)
What each bot does (all paper-only, none places a real order, none is a profit claim):
- Backup Bot: snapshots journal + engine state into data/backups (newest 40 kept). Integrity Bot: finds impossible/duplicate/inconsistent journal rows. Data Health Bot: feed/journal health, engine skips NEW calls when not ok; pills on /dashboard. Exposure Guard: max 2 open, 2 same direction, 6 calls/day, stock loss streak 3, Nifty against.
- Trade Autopsy (/autopsy, lib/autopsy.js): replays a trade bar by bar and says why it won or lost. Self-Test Bot: `npm run selftest` (28 tests). Research bots (/research): news, sentiment, credibility, impact, fundamentals, movement, chief (context only).
Results actually measured: chart patterns FAIL (6,589 signals, PF 0.24, -0.60R/trade; reversed direction PF 0.25, so no information). Multi-stock autopsy of the terminal's own logic: 6,560 simulated trades, win 22.7%, PF 0.25, -0.29R/trade; losses = 50% time decay, 35.5% trend against, 6.3% late entry, 4.4% noise stop, 0.4% gap; VWAP-breach exit ends 30% of trades at -0.69R avg. The 100-trade gate is at 2/100 real paper trades.
Still unverified / gaps: server engine has never run in a live market session (needs SERVER_ENGINE=1, not yet set in .env.local); Exposure Guard and health gating untested live; 2 real journal trades (12 Oct) cannot be autopsied (no candles for that day); candle API 403s can still blank charts (tick-built candles not built); Telegram alerts and a VPS not built; old passwords are in git history (rotate); call-bot backtest.py needs a run on a PC with internet (cloud has no Yahoo).
Tomorrow morning, in this order: 1) git push origin main (device is 7 commits ahead of origin). 2) Restart npm run dev. 3) Add SERVER_ENGINE=1 to .env.local, keep the laptop on, and watch /dashboard pills + /api/engine at 09:30. 4) Run node scripts/fetch-movers.mjs after the close so today's candles exist, then refresh /autopsy. 5) Next tests (history only): loosen/drop the VWAP-breach exit, longer hold than 25 min, fewer stricter entries, longer history.

## 2026-10-18 what-if: longer hold + looser VWAP exit (analysis/autopsy_batch.mjs, env HOLD_BARS, VWAP_BUF_PCT; baseline files are not overwritten)
Same 42 stocks x 63 days, same costs. Net R/trade after costs, PF (all / test half):
- hold 25 min (today): -0.29R, PF 0.25 / 0.31. 40 min: -0.29R, 0.31 / 0.41. 60 min: -0.30R, 0.35 / 0.43. 90 min: -0.31R, 0.37 / 0.46. 150 min: -0.32R, 0.39 / 0.48.
- VWAP-breach buffer 0.05% (today) / 0.15% / 0.3% / exit off, at 25 min: -0.29 / -0.29 / -0.29 / -0.28R, PF 0.25 / 0.27 / 0.28 / 0.28. At 60 min hold: -0.30 / -0.29 / -0.29 / -0.29R, PF 0.35 / 0.38 / 0.40 / 0.40 (test half 0.50 at best).
- Reading: win rate and PF rise (22.7% -> 31.7% win) but net R per trade stays about -0.29R, and the best PF (0.40, test 0.50) is far below the 1.3 gate. Exits are not the main problem; entry quality and cost drag (about -0.4R per trade) are. Nothing was changed in the live rules (still 25 min, 0.05% VWAP buffer).
- Next: fewer, stricter entries (e.g. only strong score + volume + trend day), bigger targets relative to cost, longer history (6-12 months).

## Idea parked: NSE Market Lens (marketlens.nseindia.com, beta, official screener)
- Fundamentals-only screener (Market Cap, P/E, ROCE, ROE, Debt/Equity, growth) over 2,000+ NSE stocks, data from Cogencis. No price/candle data, so it cannot improve intraday signals directly.
- Possible later use: pre-market watchlist hygiene (drop weak/high-debt names) and a cross-check for the Yahoo fundamentals bot. Only after a history test shows it helps; unknown whether an API/export exists.
- Also looked at ai-tradingterminal.com (AITT): landing page only, no performance claims. Design ideas worth borrowing: offline-first, strict GUI/backend/agents/broker separation.

## 2026-10-18 what-if: stricter score + bigger targets (env MIN_SCORE, TGT_SCALE; run with hold 60 min, VWAP buffer 0.3%)
Net R/trade after costs, PF all / test half, n trades:
- min |score| 65 (today): n 5,909, -0.29R, PF 0.40 / 0.49. 75: n 4,637, -0.29R, PF 0.39 / 0.47. 85: n 3,255, -0.31R, PF 0.37 / 0.40.
- targets x1.5 instead of x1 changed nothing (-0.29R, same PF): targets are rarely reached inside 60 min.
- Reading: a higher score does NOT predict better trades (85 is slightly worse than 65), so the composite score itself carries no usable edge on this data; bigger targets do not help. Nothing changed in the live rules. Still no setup near the gate (PF >= 1.3).
- Next ideas (history only): different entry logic instead of tuning this one (e.g. opening-range / relative-strength / volume-spike days), longer history (6-12 months), daily/swing timeframe where cost drag is smaller.

## 2026-10-18 hindsight / reverse-engineering study (analysis/hindsight.mjs -> analysis/hindsight_summary.json)
Method: every 5m bar in the trade windows, both directions (213,528 samples, 42 stocks, 63 days). Hindsight label = a trade at the next open (SL 1.2 ATR, target 2.0 ATR, 60-min hold, costs + slippage) reached its target. ~35 factors visible at the signal bar's close were then compared on a chronological 70/30 split. DIAGNOSTIC; with ~35 factors tested some look good by chance.
- Baseline (take every bar): target hit 19.8%, net -0.51R/trade (train -0.53, test -0.47).
- NO single factor has positive net R after costs on both halves (0 of 35). Best (least bad) on the later 30%: ATR% > 0.30 (-0.29R), gap against (-0.40R), first hour (-0.40R). Worst: calm ATR% < 0.15 (-0.68R) and afternoon window (-0.56R).
- Pairs: best was ATR% > 0.30 + RSI extreme against: -0.29 / -0.24R (PF 0.62 test). Nothing positive.
- Why ATR% matters: costs (Rs 40 + 0.035%) are fixed, so quiet stocks pay far more cost per R. This is a cost effect, not a signal. Idea to test: only trade high-ATR% stocks/days, wider stops, fewer trades.
- Tool vs hindsight: the tool's score (>= 65 on the side) was present before 14.3% of the trades that reached their target (85.7% missed). When the score was >= 65, 20.0% reached target vs 19.8% for a random bar (lift 1.01): the score adds no information here.
- What was visible before the good trades the tool missed: nothing stands out (largest over-representation x1.14, calm ATR, volume spike, afternoon). Candle patterns and chart patterns: no edge either, in line with the earlier pattern backtest.
- Conclusion: none of the standard indicators/patterns we have predicts a profitable 5m trade after costs; the loss is mostly cost drag (-0.5R/trade baseline). Next: volatility/cost-aware filtering (high ATR% only), other timeframe (daily/swing), more history.

## Daily / swing study (analysis/daily_swing.mjs)
- 83 stocks, 8 years daily, long-only, costs 0.25% + 0.05%/side slippage, train <=2023 / test 2024+, with a no-signal control.
- 96 configs: 0 passed the gate. Train looked great (PF 1.5-1.8) but mostly market drift (control ~ same); test mostly negative.
- Best honest: "trend pullback (SMA50>SMA200, close<=EMA20, RSI14<45), stop 3 ATR, hold 40d": test +0.62%/trade PF 1.15, 6/8 yrs positive, beats control only ~0.5%. Below PF 1.3 gate.
- Momentum (monthly top-K by 6m return): beats equal-weight by ~0.1-0.4%/month in both halves, but hit-rate 50-59% and survivorship bias (today's stock list) inflates it. Not tradable proof.
- Verdict: still no validated edge. Daily timeframe is less bad than intraday (costs matter less).

## High-ATR% intraday filter (MIN_ATRPCT env in analysis/autopsy_batch.mjs, with HOLD_BARS=12)
- Filter does nothing until ATR% >= 0.4 (almost all 5m ATR is below it); at 0.45: n=290, PF 0.48 (test 0.57), -0.27R/trade; at 0.5: n=197, PF 0.35.
- Best case still PF < 0.6 and net negative on both halves -> cost-aware filtering does not rescue the intraday rules. Gate (PF>=1.3) not met.

## Stock-selection test (STOCKSEL=1 node analysis/.build/autopsy_batch.mjs)
- User's question: maybe the stocks are wrong. Tested: 42 stocks, pick best by TRAIN net R, evaluate on TEST.
- 0 of 42 stocks positive even in train (best -0.17R). Train-vs-test correlation per stock = -0.31 (no persistence). Top 5/10/15 by train -> test: -0.30/-0.26/-0.29R, PF 0.29-0.35.
- Verdict: stock picking is not the problem; the entry/exit rules lose on every stock.

## Dynamic stock picker test (DYN=K DYN_MODE=rvol|gap|move|rs|combo|random node analysis/.build/autopsy_batch.mjs)
- Each day at 09:30 (using only 09:15-09:25 bars + prev close) rank 42 stocks, trade only the top 5 that day with the terminal's own rules.
- Net R/trade (all / test): rvol -0.26/-0.25, gap -0.30/-0.29, move -0.29/-0.23, rs same as move, combo(rvol+rs+range) -0.29/-0.28, RANDOM 5 -0.28/-0.20. PF 0.27-0.45.
- No picker beats random picking; every one is net negative. Dynamic picking does not fix the entry/exit rules.

## Dashboard: today's picks and trades (2026-10-19)
- /dashboard now has a "TODAY'S PICKS AND TRADES" card: latest 15-min picker list + picks-vs-all result + today's journal trades. Data: new /api/picks (data/picker-log.json, today only, research-only, login required).
- Found: the open terminal page (source "page") and the server engine both entered SBIN a minute apart (09:35 page, 09:40 engine) = double exposure. Needs one-owner rule (engine off while the page auto-trades, or vice versa).
- Found: Angel candle API 403s block the engine (ITC skipped repeatedly) -> needs cache + backoff.

## Reversal alert bot (2026-10-19)
- lib/reversalBot.js (pure detector) + /api/reversal (samples NIFTY/BANKNIFTY live LTP) + dashboard card. Alert only, never trades.
- Replay (analysis/reversal_replay.mjs, 63 days index 5m): 20-86 alerts per config. Index did NOT continue in the alert direction: 30-min forward move about -0.03% (NIFTY f30 -0.026%, BANKNIFTY -0.035%), negative in both train and test halves. Typical 30-min move is 0.09-0.11%, so alerts carry no directional edge. Use as heads-up only.
- Limit: it only samples while /dashboard (or any caller of /api/reversal) is open. Next: let serverEngine call it every tick; Telegram delivery.

## Helper bots audit + additions (2026-10-19)
- Already existed: Data Health (watchdog), backup, integrity, exposure guard (engine), candle cache/single-flight/backoff. Angel 403 is on Angel's side.
- Added: lib/ownerGuard.js - /api/journal POST now applies exposure limits (all sources) to NEW page calls (409 when blocked), so page and engine cannot double up.
- Added: lib/dailyReport.js + GET /api/report?day= - read-only daily summary (journal + picker). No edge claims.
- ownerGuard: added day loss limit (-3R, all sources) for page calls, same as engine.
