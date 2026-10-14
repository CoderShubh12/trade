// lib/serverEngine.js (server only)
// Runs the SAME signal rules as the dashboard, but on the server, so calls and exits are
// recorded even when no browser tab is open (e.g. you are on your phone).
//
//  * PAPER ONLY. It never sends an order to any broker.
//  * OFF unless SERVER_ENGINE=1 is set in .env.local.
//  * Evaluates the watchlist (first MAX_STOCKS) once per closed 5-minute candle.
//  * Open calls are monitored on live ticks with the app's own monitorActiveTrade()
//    (T1 -> stop to cost, T2, stop, VWAP breach, 25-min timeout, 15:15 square-off).
//  * Safety: after DAY_LOSS_R_LIMIT R lost, or MAX_CONSEC_LOSSES losses in a row, no new calls that day.
import { promises as fs } from "fs";
import path from "path";
import { buildCompositeScore } from "./signalEngine";
import { calculateATR } from "./indicators";
import { detectMarketRegime } from "./marketRegime";
import { getClosedCandles, getLiveSignalGate, getIstParts, getSessionInfo } from "./sessionUtils";
import { newSignalMemory, observeScore, checkSignalAllowed, recordEntry, recordExit } from "./signalMemory";
import { evaluateTradeSetup, monitorActiveTrade } from "./tradeManager";
import { getTicks } from "./liveFeed";
import { GET as candlesGET } from "../app/api/market-data/route.js";
import { GET as newsGET } from "../app/api/news/route.js";
import { updateJournal, upsertCall } from "./journalStore";

const TF = 5;
const TF_MS = TF * 60000;
const MAX_STOCKS = 6;
const LOOP_MS = 4000;
const DAY_LOSS_R_LIMIT = 3;
const MAX_CONSEC_LOSSES = 3;
const LOSS_COOLDOWN_MIN = 45;
const NIFTY = "99926000";
const STATE_FILE = path.join(process.cwd(), "data", "engine-state.json");
const WATCH_FILE = path.join(process.cwd(), "data", "watchlist.json");
const VERSION = 1;

const g = globalThis;
const E = (g.__engine = g.__engine && g.__engine.v === VERSION ? g.__engine : {
  v: VERSION, timer: null, busy: false, paused: false, day: "", mem: {}, trades: {}, cool: {}, evaluated: {},
  vwap: {}, vwapAt: {}, dayR: 0, consec: 0, calls: 0, exits: 0, lastNote: "", lastError: "", lastTickAt: 0, startedAt: 0, log: [],
});

const enabled = () => process.env.SERVER_ENGINE === "1";
const note = (m) => { E.lastNote = `${new Date().toISOString().slice(11, 19)} ${m}`; E.log.push(E.lastNote); if (E.log.length > 60) E.log.shift(); };
const hhmmStr = (ms) => { const p = new Date(ms + 330 * 60000).toISOString(); return p.slice(11, 16); };

async function candles(token) {
  const res = await candlesGET(new Request(`http://local/api/market-data?token=${token}&tf=${TF}`));
  const j = await res.json();
  return { data: Array.isArray(j.data) ? j.data : [], stale: !!j.stale, error: j.error || j.warning || "" };
}

async function loadWatch() {
  try {
    const l = JSON.parse(await fs.readFile(WATCH_FILE, "utf8"));
    return (Array.isArray(l) ? l : []).filter((x) => x?.symbol && /^\d+$/.test(String(x.token))).slice(0, MAX_STOCKS).map((x) => ({ symbol: String(x.symbol).toUpperCase(), token: String(x.token) }));
  } catch { return []; }
}

async function saveState() {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const snap = { day: E.day, mem: E.mem, trades: E.trades, cool: E.cool, dayR: E.dayR, consec: E.consec, calls: E.calls, exits: E.exits };
    await fs.writeFile(STATE_FILE + ".tmp", JSON.stringify(snap), "utf8");
    await fs.rename(STATE_FILE + ".tmp", STATE_FILE);
  } catch { /* state is a convenience, not critical */ }
}
async function loadState(day) {
  try {
    const s = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    if (s.day === day) Object.assign(E, { day, mem: s.mem || {}, trades: s.trades || {}, cool: s.cool || {}, dayR: s.dayR || 0, consec: s.consec || 0, calls: s.calls || 0, exits: s.exits || 0 });
  } catch { /* first run today */ }
}

async function niftyBias(now) {
  try {
    const { data } = await candles(NIFTY);
    const today = getSessionInfo(data).today;
    const open = today[0]?.open;
    if (!open) return "NEUTRAL";
    let ltp = data[data.length - 1].close;
    const t = (await getTicks([NIFTY])).ticks?.[NIFTY];
    if (t && t.ageMs < 5000 && Math.abs(t.ltp / ltp - 1) < 0.03) ltp = t.ltp;
    const pct = ((ltp - open) / open) * 100;
    return pct <= -0.2 ? "BEARISH" : pct >= 0.2 ? "BULLISH" : "NEUTRAL";
  } catch { return "NEUTRAL"; }
}

async function closeTrade(tr, price, reason, now) {
  const dir = tr.action === "SELL" ? -1 : 1;
  const risk = Math.abs(tr.entry - (tr.initialSl ?? tr.stopLoss)) || 1;
  const pnl = dir * (price - tr.entry);
  const r = pnl / risk;
  await updateJournal((list) => {
    const i = list.findIndex((x) => x.id === tr.logId);
    if (i < 0) return;
    list[i] = { ...list[i], exitPrice: price, exitClock: hhmmStr(now), reason, r, source: "engine" };
    return list;
  });
  E.mem[tr.token] = recordExit(E.mem[tr.token], now);
  E.exits += 1;
  E.dayR += r;
  const profit = tr.t1Reached || pnl > 0;
  E.consec = profit ? 0 : E.consec + 1;
  if (!profit) E.cool[tr.token] = now + LOSS_COOLDOWN_MIN * 60000;
  delete E.trades[tr.token];
  note(`EXIT ${tr.symbol} ${tr.action} ${reason} ${r.toFixed(2)}R`);
  await saveState();
}

async function monitor(now) {
  for (const tr of Object.values(E.trades)) {
    try {
      const tk = (await getTicks([tr.token])).ticks?.[tr.token];
      if (!tk || tk.ageMs > 15000) continue;
      // refresh VWAP at most every 20 s (candle route is cached and throttled)
      if (!E.vwap[tr.token] || now - (E.vwapAt[tr.token] || 0) > 20000) {
        const { data, stale } = await candles(tr.token);
        if (data.length && !stale) {
          const b = buildCompositeScore(data, TF, false);
          if (b.ind?.latest?.vwap) { E.vwap[tr.token] = b.ind.latest.vwap; E.vwapAt[tr.token] = now; }
        }
      }
      const vwap = E.vwap[tr.token] || tr.entry;
      const st = monitorActiveTrade(tr, tk.ltp, vwap, now);
      if (!st) continue;
      if (st.isPartial) { await saveState(); note(`T1 ${tr.symbol} stop->${st.newSl}`); continue; }
      if (st.exit) await closeTrade(tr, tk.ltp, st.reason, now);
    } catch (e) { E.lastError = String(e.message || e); }
  }
}

// News tag for the ML features only (never used to decide the call). Any failure => "nodata".
async function newsTag(symbol) {
  try {
    const res = await Promise.race([newsGET(new Request(`http://local/api/news?symbol=${encodeURIComponent(symbol)}`)), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))]);
    const j = await res.json();
    return j && j.available ? { newsSent: Number(j.sentiment) || 0, eventRisk: String(j.eventRisk || "none") } : { newsSent: 0, eventRisk: "nodata" };
  } catch { return { newsSent: 0, eventRisk: "nodata" }; }
}

async function evaluate(stock, now, bias) {
  const { symbol, token } = stock;
  const boundary = Math.floor(now / TF_MS) * TF_MS;
  if (E.evaluated[token] === boundary || E.trades[token]) return;
  if (now < boundary + 8000 || now > boundary + 150000) { if (now > boundary + 150000) E.evaluated[token] = boundary; return; }
  if (E.cool[token] && now < E.cool[token]) return;
  if (E.paused) return;
  if (E.dayR <= -DAY_LOSS_R_LIMIT) { note(`day loss limit reached (${E.dayR.toFixed(1)}R) - no new calls`); E.evaluated[token] = boundary; return; }
  if (E.consec >= MAX_CONSEC_LOSSES) { E.evaluated[token] = boundary; return; }

  const { data, stale, error } = await candles(token);
  if (!data.length || stale) { if (error) E.lastError = `${symbol}: ${error}`; return; } // try again on a later loop
  const gate = getLiveSignalGate(data, TF, now);
  if (!gate.allowed) { E.evaluated[token] = boundary; return; }
  const closed = getClosedCandles(data, TF, now);
  const last = closed[closed.length - 1];
  if (!last || last.time * 1000 < boundary - TF_MS) return; // newest closed candle has not arrived yet

  E.evaluated[token] = boundary;
  const dayKey = getIstParts(now).dateStr;
  const basis = buildCompositeScore(closed, TF, true);
  const score = basis.score;
  E.mem[token] = observeScore(E.mem[token], score, dayKey);
  if (Math.abs(score) < 65) return;
  const allowed = checkSignalAllowed(E.mem[token], now);
  if (!allowed.allowed) return;

  const atr = calculateATR(closed, 14);
  const vwap = basis.ind?.latest?.vwap;
  const regime = detectMarketRegime(data);
  const setup = await evaluateTradeSetup(score, bias, last, vwap, atr, { nowMs: now, bypassTimeWindow: false, useGroqValidation: false, symbol, timeframe: String(TF), regime });
  if (!setup || (setup.action !== "BUY" && setup.action !== "SELL")) return;

  E.mem[token] = recordEntry(E.mem[token], setup.action);
  const nt = await newsTag(symbol);
  const logId = `${now}-${token}`;
  const tr = { symbol, token, side: setup.action, action: setup.action, entry: setup.entry, target1: setup.target1, target2: setup.target2, sl: setup.stopLoss, stopLoss: setup.stopLoss, initialSl: setup.initialSl, t1Reached: false, startTime: now, maxTime: setup.maxTime, logId };
  E.trades[token] = tr;
  E.calls += 1;
  await upsertCall({
    id: logId, symbol, side: setup.action, timeframe: String(TF), token, dateStr: dayKey, entryClock: hhmmStr(now),
    entry: setup.entry, stopLoss: setup.stopLoss, initialSl: setup.initialSl, target1: setup.target1, target2: setup.target2,
    exitPrice: null, exitClock: "", reason: "", r: null, source: "engine",
    feat: {
      score, atrPct: atr ? +((atr / setup.entry) * 100).toFixed(3) : 0, vwapDist: atr && vwap ? +((setup.entry - vwap) / atr).toFixed(3) : 0,
      vol: Number(last.volume) || 0, regime: String(regime || ""), niftyBias: bias, mins: (Math.floor(now / 60000) + 330) % 1440,
      newsSent: nt.newsSent, eventRisk: nt.eventRisk,
    },
  });
  note(`CALL ${symbol} ${setup.action} @${setup.entry} sl ${setup.stopLoss} t1 ${setup.target1} (score ${score}, ${regime})`);
  await saveState();
}

async function tick() {
  if (E.busy || !enabled()) return;
  E.busy = true;
  try {
    const now = Date.now();
    E.lastTickAt = now;
    const day = getIstParts(now).dateStr;
    if (E.day !== day) { Object.assign(E, { day, mem: {}, trades: {}, cool: {}, evaluated: {}, vwap: {}, vwapAt: {}, dayR: 0, consec: 0, calls: 0, exits: 0 }); await loadState(day); }
    if (Object.keys(E.trades).length) await monitor(now);
    const { hhmm, day: dow } = getIstParts(now);
    if (dow === 0 || dow === 6 || hhmm < 930 || hhmm > 1445) return;
    const watch = await loadWatch();
    if (!watch.length) return;
    const due = watch.filter((s) => !E.trades[s.token] && E.evaluated[s.token] !== Math.floor(now / TF_MS) * TF_MS);
    if (!due.length) return;
    const bias = await niftyBias(now);
    for (const s of due) { await evaluate(s, Date.now(), bias); }
  } catch (e) {
    E.lastError = String(e.message || e);
  } finally {
    E.busy = false;
  }
}

export function startEngine() {
  if (!enabled()) return false;
  if (E.timer) return true;
  E.startedAt = Date.now();
  E.timer = setInterval(() => { tick(); }, LOOP_MS);
  note("engine started (paper only)");
  return true;
}
export function pauseEngine(p) { E.paused = !!p; return E.paused; }
export function engineStatus() {
  return {
    enabled: enabled(), running: !!E.timer, paused: E.paused, day: E.day, calls: E.calls, exits: E.exits,
    dayR: +E.dayR.toFixed(2), consecLosses: E.consec, open: Object.values(E.trades).map((t) => ({ symbol: t.symbol, side: t.action, entry: t.entry, sl: t.stopLoss, t1: t.target1 })),
    lastTickAt: E.lastTickAt, lastNote: E.lastNote, lastError: E.lastError, log: E.log.slice(-15),
    limits: { dayLossR: DAY_LOSS_R_LIMIT, consecLosses: MAX_CONSEC_LOSSES, maxStocks: MAX_STOCKS },
  };
}
