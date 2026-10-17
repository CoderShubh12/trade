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
