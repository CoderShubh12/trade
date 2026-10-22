// scripts/selftest.mjs : offline self-test of the parts that protect the paper-trading record and decide calls/exits.
//   node scripts/selftest.mjs        (or: npm run selftest)
// No network, no Angel, no Groq. The journal test runs in a temp folder, so your real data/ is never touched.
// Exit code 1 if anything fails. Run it after every change to lib/.
import "./register.mjs"; // lets plain node resolve the extensionless imports used inside lib/
import os from "os";
import fs from "fs";
import path from "path";

// The backup bot must not write snapshots of the REAL journal while we test: mark it busy before it is imported.
globalThis.__backupBot = { last: 0, lastDay: "", busy: true };

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, true]); console.log(`PASS  ${name}`); }
  catch (e) { results.push([name, false]); console.log(`FAIL  ${name}\n        ${String(e && e.message ? e.message : e)}`); }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || "expected"} ${JSON.stringify(b)} but got ${JSON.stringify(a)}`); };
const ok = (c, msg) => { if (!c) throw new Error(msg || "assertion failed"); };
// IST clock -> epoch ms (IST = UTC+5:30)
const ist = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;

const { getIstParts, getTradeWindowStatus } = await import("../lib/sessionUtils.js");
const { evaluateTradeSetup, monitorActiveTrade } = await import("../lib/tradeManager.js");
const SM = await import("../lib/signalMemory.js");
const { detectChartPatterns } = await import("../lib/chartPatterns.js");
const { autopsyTrade } = await import("../lib/autopsy.js");
const { checkJournal, evaluateHealth, checkExposure, EXPOSURE } = await import("../lib/safetyBots.js");
const { buildCompositeScore } = await import("../lib/signalEngine.js");

// ---------------------------------------------------------------- IST + trade window
await test("IST helper: UTC time maps to the right IST date and clock", () => {
  const a = getIstParts(Date.UTC(2026, 9, 14, 3, 45));        // 03:45 UTC = 09:15 IST
  eq(a.dateStr, "2026-10-14", "date"); eq(a.hhmm, 915, "hhmm");
  const b = getIstParts(Date.UTC(2026, 9, 14, 19, 0));        // 19:00 UTC = 00:30 IST next day
  eq(b.dateStr, "2026-10-15", "date rolls over after 18:30 UTC"); eq(b.hhmm, 30, "hhmm");
  eq(getIstParts(ist(2026, 10, 17, 10)).day, 6, "17 Oct 2026 is a Saturday");
});
await test("Trade window: whole session 09:30-14:45 (owner request 22 Oct), nothing before 09:30 or from 14:46 / 15:15", () => {
  const w = (h, m) => getTradeWindowStatus(ist(2026, 10, 14, h, m)).allowed;
  eq(w(9, 20), false, "09:20"); eq(w(9, 30), true, "09:30"); eq(w(11, 30), true, "11:30"); eq(w(11, 31), true, "11:31");
  eq(w(12, 30), true, "12:30"); eq(w(13, 30), true, "13:30"); eq(w(14, 45), true, "14:45"); eq(w(14, 46), false, "14:46"); eq(w(15, 15), false, "15:15");
});

// ---------------------------------------------------------------- exit logic (monitorActiveTrade)
const mk = (action) => action === "BUY"
  ? { action, entry: 100, stopLoss: 98.5, target1: 103, target2: 105, t1Reached: false, maxTime: ist(2026, 10, 14, 10, 25) }
  : { action, entry: 100, stopLoss: 101.5, target1: 97, target2: 95, t1Reached: false, maxTime: ist(2026, 10, 14, 10, 25) };
const T0 = ist(2026, 10, 14, 10, 5);
await test("Exit BUY: price at/below the stop closes the trade as STOP_LOSS_HIT", () => {
  const r = monitorActiveTrade(mk("BUY"), 98.4, 95, T0);
  ok(r && r.exit && r.reason === "STOP_LOSS_HIT", JSON.stringify(r));
});
await test("Exit BUY: price between stop and target keeps the trade open", () => {
  const r = monitorActiveTrade(mk("BUY"), 101, 95, T0);
  ok(!r || !r.exit, JSON.stringify(r));
});
await test("Exit BUY: T1 moves the stop to cost (entry +0.1%), then falling back exits at TRAILING_SL_HIT", () => {
  const tr = mk("BUY");
  const a = monitorActiveTrade(tr, 103.2, 95, T0);
  ok(a && a.isPartial && !a.exit, "T1 should be a partial, not an exit");
  eq(tr.t1Reached, true, "t1Reached"); eq(tr.stopLoss, 100.1, "stop at cost");
  const b = monitorActiveTrade(tr, 100.0, 95, T0 + 60000);
  ok(b && b.exit && b.reason === "TRAILING_SL_HIT", JSON.stringify(b));
});
await test("Exit BUY: T2 closes the trade", () => {
  const r = monitorActiveTrade(mk("BUY"), 105.1, 95, T0);
  ok(r && r.exit && r.reason === "TARGET_2_HIT", JSON.stringify(r));
});
await test("Exit SELL mirrors BUY: stop, T1->cost, T2", () => {
  const r1 = monitorActiveTrade(mk("SELL"), 101.6, 110, T0); ok(r1 && r1.exit && r1.reason === "STOP_LOSS_HIT", JSON.stringify(r1));
  const tr = mk("SELL"); const a = monitorActiveTrade(tr, 96.9, 110, T0);
  ok(a && a.isPartial, "T1 partial"); eq(tr.stopLoss, 99.9, "stop at cost");
  const r2 = monitorActiveTrade(mk("SELL"), 94.9, 110, T0); ok(r2 && r2.exit && r2.reason === "TARGET_2_HIT", JSON.stringify(r2));
});
await test("Exit: 25-minute time stop (TIME_DECAY_TIMEOUT)", () => {
  const r = monitorActiveTrade(mk("BUY"), 100.5, 95, ist(2026, 10, 14, 10, 26));
  ok(r && r.exit && r.reason === "TIME_DECAY_TIMEOUT", JSON.stringify(r));
});
await test("Exit: 15:15 square-off beats everything else", () => {
  const tr = mk("BUY"); tr.maxTime = ist(2026, 10, 14, 15, 40);
  const r = monitorActiveTrade(tr, 101, 95, ist(2026, 10, 14, 15, 15));
  ok(r && r.exit && r.reason === "MARKET_CLOSE_SQUAREOFF", JSON.stringify(r));
});
await test("Exit: VWAP breach (0.05% buffer) exits a BUY below VWAP and a SELL above VWAP", () => {
  const b = monitorActiveTrade(mk("BUY"), 99.0, 100, T0); ok(b && b.exit && b.reason === "VWAP_BREACH_EXIT", JSON.stringify(b));
  const s = monitorActiveTrade(mk("SELL"), 101.0, 100, T0); ok(s && s.exit && s.reason === "VWAP_BREACH_EXIT", JSON.stringify(s));
  const near = monitorActiveTrade(mk("BUY"), 99.97, 100, T0); ok(!near || !near.exit, "inside the buffer must not exit");
});

// ---------------------------------------------------------------- entry rules
const candle = { time: 1, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 };
await test("Entry: score >= 65 gives BUY with SL 1.2 ATR, T1 2 ATR, T2 3.5 ATR, 25-min max time", async () => {
  const now = ist(2026, 10, 14, 10, 0);
  const s = await evaluateTradeSetup(70, "NEUTRAL", candle, 100, 2, { nowMs: now, symbol: "T" });
  eq(s.action, "BUY", "action"); eq(s.stopLoss, 97.6, "sl"); eq(s.target1, 104, "t1"); eq(s.target2, 107, "t2"); eq(s.maxTime, now + 25 * 60000, "maxTime");
});
await test("Entry: score <= -65 gives SELL; Nifty bias against the side blocks the call", async () => {
  const now = ist(2026, 10, 14, 10, 0);
  eq((await evaluateTradeSetup(-70, "NEUTRAL", candle, 100, 2, { nowMs: now })).action, "SELL", "sell");
  eq((await evaluateTradeSetup(70, "BEARISH", candle, 100, 2, { nowMs: now })).action, "WAIT", "buy vs bearish nifty");
  eq((await evaluateTradeSetup(-70, "BULLISH", candle, 100, 2, { nowMs: now })).action, "WAIT", "sell vs bullish nifty");
});
await test("Entry: weak score or outside the session (before 09:30 / after 14:45) gives WAIT", async () => {
  eq((await evaluateTradeSetup(60, "NEUTRAL", candle, 100, 2, { nowMs: ist(2026, 10, 14, 10, 0) })).action, "WAIT", "weak score");
  eq((await evaluateTradeSetup(80, "NEUTRAL", candle, 100, 2, { nowMs: ist(2026, 10, 14, 15, 0) })).action, "WAIT", "after 14:45");
});

// ---------------------------------------------------------------- signal memory
await test("Signal memory: one call per setup, re-arms below 50 or on a flip", () => {
  let m = SM.newSignalMemory("d1");
  ok(SM.checkSignalAllowed(m, 0).allowed, "first call allowed");
  m = SM.recordEntry(m, "BUY");
  ok(!SM.checkSignalAllowed(m, 0).allowed, "second call on the same setup blocked");
  m = SM.observeScore(m, 80, "d1"); ok(!m.armed, "score still high: stays disarmed");
  m = SM.observeScore(m, 40, "d1"); ok(m.armed, "score cooled below 50: re-armed");
  m = SM.recordEntry(m, "BUY"); m = SM.observeScore(m, -70, "d1"); ok(m.armed, "flip to the other side re-arms");
});
await test("Signal memory: 30-min cooldown after an exit, max 3 calls per stock per day, new day resets", () => {
  let m = SM.newSignalMemory("d1");
  m = SM.recordExit(m, 1000000);
  ok(!SM.checkSignalAllowed(m, 1000000 + 29 * 60000).allowed, "29 min after exit blocked");
  ok(SM.checkSignalAllowed(m, 1000000 + 31 * 60000).allowed, "31 min after exit allowed");
  let c = SM.newSignalMemory("d1");
  for (let i = 0; i < 3; i++) { c = SM.recordEntry(c, "BUY"); c = SM.observeScore(c, 10, "d1"); }
  ok(!SM.checkSignalAllowed(c, 0).allowed, "4th call blocked");
  const n = SM.observeScore(c, 10, "d2"); eq(n.entries, 0, "new day starts fresh"); ok(SM.checkSignalAllowed(n, 0).allowed, "allowed on the new day");
});

// ---------------------------------------------------------------- composite score sanity
await test("Composite score: empty input is 0, a long uptrend stays inside -100..100", () => {
  eq(buildCompositeScore([], 5, true).score, 0, "empty");
  const c = []; let p = 100;
  for (let d = 0; d < 3; d++) for (let i = 0; i < 75; i++) { const o = p; p += 0.05 + (i % 3 ? 0.02 : -0.01); const m = 9 * 60 + 15 + i * 5; c.push({ time: Math.floor(ist(2026, 10, 12 + d, 0, 0) / 1000) + m * 60 - 0, date: `2026-10-${12 + d}`, clock: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, open: o, high: p + 0.1, low: o - 0.1, close: p, volume: 1000 + i }); }
  const s = buildCompositeScore(c, 5, true).score;
  ok(Number.isFinite(s) && s >= -100 && s <= 100, `score ${s}`);
});

// ---------------------------------------------------------------- journal store + integrity
await test("Journal store: same call is stored once, ids merge, different clock = new row (temp folder)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nse-selftest-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const J = await import("../lib/journalStore.js");
    const base = { id: "a1", symbol: "SBIN", side: "BUY", dateStr: "2026-10-14", entryClock: "10:00", entry: 100, stopLoss: 98.8, initialSl: 98.8, target1: 102.4, exitPrice: null };
    await J.upsertCall(base);
    await J.upsertCall({ ...base, id: "a2" });                              // same call, different id (double-fire)
    eq((await J.readJournal()).length, 1, "double fire collapsed to one row");
    await J.upsertCall({ ...base, exitPrice: 102.4, exitClock: "10:20", reason: "T1", r: 2 });
    const l = await J.readJournal(); eq(l.length, 1, "update keeps one row"); eq(l[0].exitPrice, 102.4, "merged exit"); eq(l[0].id, "a1", "first id kept");
    await J.upsertCall({ ...base, id: "b1", entryClock: "10:30" });
    eq((await J.readJournal()).length, 2, "different entry clock is a new call");
    // parallel writers must not lose rows
    await Promise.all(Array.from({ length: 12 }, (_, i) => J.upsertCall({ ...base, id: `p${i}`, entryClock: `11:${String(i).padStart(2, "0")}` })));
    eq((await J.readJournal()).length, 14, "12 parallel writes all kept");
    ok(fs.existsSync(path.join(dir, "data", "paper-journal.json")), "file written inside the temp folder");
  } finally {
    await new Promise((r) => setTimeout(r, 150)); // let the throttled backup finish
    process.chdir(cwd);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
await test("Integrity checker: flags duplicate ids, illogical levels, exit before entry, wrong R; accepts a clean row", () => {
  const good = { id: "g", symbol: "X", side: "BUY", token: "1", dateStr: "2026-10-14", entryClock: "10:00", entry: 100, initialSl: 98.8, target1: 102.4, exitPrice: 102.4, exitClock: "10:20", reason: "T1", r: 2 };
  const clean = checkJournal([good], ist(2026, 10, 14, 16));
  eq(clean.counts.error, 0, "clean row has no errors");
  const codes = (rows) => checkJournal(rows, ist(2026, 10, 14, 16)).issues.map((i) => i.code);
  ok(codes([good, { ...good, entryClock: "10:05" }]).includes("DUP_ID"), "DUP_ID");
  ok(codes([{ ...good, id: "h", initialSl: 101 }]).includes("BAD_LEVELS"), "BAD_LEVELS (BUY with stop above entry)");
  ok(codes([{ ...good, id: "i", exitClock: "09:50" }]).includes("EXIT_BEFORE_ENTRY"), "EXIT_BEFORE_ENTRY");
  ok(codes([{ ...good, id: "j", r: -1 }]).includes("R_MISMATCH"), "R_MISMATCH");
  ok(codes([{ ...good, id: "k", exitPrice: null, dateStr: "2026-10-13" }]).includes("STALE_OPEN"), "STALE_OPEN");
});
await test("Health rules: closed market is ok, 3 candle failures or an old tick is down, integrity errors block", () => {
  const base = { marketOpen: true, candleFails: 0, candlePauseSec: 0, quoteError: "", tickAgeSec: 3, integrityErrors: 0 };
  eq(evaluateHealth(base).level, "ok", "healthy");
  eq(evaluateHealth({ ...base, marketOpen: false, tickAgeSec: null, candleFails: 5 }).level, "ok", "closed market");
  eq(evaluateHealth({ ...base, candleFails: 3 }).level, "down", "3 fails");
  eq(evaluateHealth({ ...base, tickAgeSec: 90 }).level, "down", "stale tick");
  eq(evaluateHealth({ ...base, tickAgeSec: 30 }).level, "degraded", "slow tick");
  eq(evaluateHealth({ ...base, integrityErrors: 1, marketOpen: false }).level, "down", "integrity error blocks even when closed");
});

// ---------------------------------------------------------------- exposure guard
await test("Exposure guard: max 2 open, max 2 in one direction, day cap 6", () => {
  const b = { side: "BUY", open: [], callsToday: 0, stockResults: [], niftyPct: 0 };
  eq(checkExposure(b).allowed, true, "empty book");
  eq(checkExposure({ ...b, open: [{ action: "BUY" }] }).allowed, true, "1 open");
  const two = checkExposure({ ...b, open: [{ action: "BUY" }, { action: "BUY" }] }); eq(two.allowed, false, "2 open"); eq(two.code, "MAX_OPEN", "code");
  eq(checkExposure({ ...b, side: "SELL", open: [{ action: "BUY" }, { action: "BUY" }] }).code, "MAX_OPEN", "max open applies to the opposite side too");
  eq(checkExposure({ ...b, callsToday: 5 }).allowed, true, "5 calls so far");
  eq(checkExposure({ ...b, callsToday: 6 }).code, "DAY_CAP", "6th is the last allowed, 7th blocked");
  const r2 = { ...EXPOSURE, MAX_OPEN: 3 };                       // same-direction rule on its own
  eq(checkExposure({ ...b, open: [{ action: "BUY" }, { action: "BUY" }] }, r2).code, "SAME_DIR", "2 BUY open blocks a 3rd BUY");
  eq(checkExposure({ ...b, side: "SELL", open: [{ action: "BUY" }, { action: "BUY" }] }, r2).allowed, true, "a SELL is fine against 2 BUY");
});
// ---------------------------------------------------------------- single-owner guard (page calls)
await test("Owner guard: new page call obeys the same limits across page + engine rows; updates pass; orphan exits and day loss are blocked", async () => {
  const { checkNewCall } = await import("../lib/ownerGuard.js");
  const d = "2026-10-21";
  const row = (id, symbol, side, extra = {}) => ({ id, symbol, side, dateStr: d, exitPrice: null, ...extra });
  const nu = (symbol, side, extra = {}) => ({ id: "new-" + symbol, symbol, side, dateStr: d, exitPrice: null, ...extra });
  eq(checkNewCall([], nu("A", "BUY")).allowed, true, "empty book");
  eq(checkNewCall([row("1", "A", "BUY"), row("2", "B", "BUY", { source: "engine" })], nu("C", "SELL")).code, "MAX_OPEN", "2 open (page+engine) blocks a 3rd");
  eq(checkNewCall([row("1", "A", "BUY")], nu("A", "SELL")).code, "SYMBOL_OPEN", "same symbol already open");
  eq(checkNewCall([row("1", "A", "BUY")], { ...nu("A", "BUY"), id: "1" }).code, "UPDATE", "same id is an update");
  eq(checkNewCall([row("1", "A", "BUY")], nu("Z", "BUY", { exitPrice: 5, r: -1 })).code, "ORPHAN_EXIT", "exit without entry is rejected");
  eq(checkNewCall([row("1", "A", "BUY", { exitPrice: 1, r: 0.5 })], { ...nu("A", "BUY"), id: "1", exitPrice: 2 }).code, "UPDATE", "closing a stored call passes");
  const lost = [row("1", "A", "BUY", { exitPrice: 1, r: -1.7 }), row("2", "B", "SELL", { exitPrice: 1, r: -1.4 })];
  eq(checkNewCall(lost, nu("C", "BUY")).code, "DAY_LOSS", "-3.1R today blocks new calls");
  eq(checkNewCall([row("1", "A", "BUY", { exitPrice: 1, r: -2 })], nu("C", "BUY")).allowed, true, "-2R is still inside the -3R limit");
});
await test("Exposure guard: 3 losses in a row on a stock today block it; a win in between does not", () => {
  const b = { side: "BUY", open: [], callsToday: 3, niftyPct: 0 };
  eq(checkExposure({ ...b, stockResults: ["L", "L", "L"] }).code, "STOCK_STREAK", "LLL");
  eq(checkExposure({ ...b, stockResults: ["W", "L", "L"] }).allowed, true, "WLL");
  eq(checkExposure({ ...b, stockResults: ["L", "L", "W", "L", "L"] }).allowed, true, "LLWLL");
  eq(checkExposure({ ...b, stockResults: ["W", "L", "L", "L"] }).code, "STOCK_STREAK", "last three are losses");
});
await test("Exposure guard: calls against a strong Nifty move (score beyond +/-25 = 0.5%) are blocked", () => {
  const b = { open: [], callsToday: 0, stockResults: [] };
  eq(checkExposure({ ...b, side: "BUY", niftyPct: -0.49 }).allowed, true, "BUY at -0.49%");
  eq(checkExposure({ ...b, side: "BUY", niftyPct: -0.5 }).code, "NIFTY_AGAINST", "BUY at -0.5%");
  eq(checkExposure({ ...b, side: "SELL", niftyPct: 0.6 }).code, "NIFTY_AGAINST", "SELL at +0.6%");
  eq(checkExposure({ ...b, side: "SELL", niftyPct: -0.9 }).allowed, true, "SELL with a falling Nifty is fine");
  eq(checkExposure({ ...b, side: "BUY", niftyPct: null }).allowed, true, "unknown Nifty does not block");
});
await test("Exposure guard: replay of a hand-built day keeps the book inside the limits", () => {
  const open = []; let calls = 0; const blocked = [];
  const tryOpen = (side, res = []) => { const r = checkExposure({ side, open, callsToday: calls, stockResults: res, niftyPct: 0 }); if (r.allowed) { open.push({ action: side }); calls++; } else blocked.push(r.code); return r.allowed; };
  eq(tryOpen("BUY"), true, "1st"); eq(tryOpen("BUY"), true, "2nd"); eq(tryOpen("SELL"), false, "3rd blocked by MAX_OPEN"); open.length = 0;
  for (let i = 0; i < 4; i++) { tryOpen("BUY"); open.length = 0; }
  eq(calls, 6, "6 calls opened"); eq(tryOpen("BUY"), false, "7th call refused"); eq(blocked[blocked.length - 1], "DAY_CAP", "refused by the day cap"); eq(calls, 6, "still 6");
});
await test("Exposure guard is wired into the engine BEFORE a call is recorded, and only blocks new calls", () => {
  const src = fs.readFileSync(new URL("../lib/serverEngine.js", import.meta.url), "utf8");
  const g = src.indexOf("checkExposure({"), r = src.indexOf("E.mem[token] = recordEntry(");
  ok(g > 0 && r > 0 && g < r, "guard must run before recordEntry");
  ok(/if \(!ex\.allowed\)[\s\S]{0,260}return;/.test(src), "a blocked call must return");
  const mon = src.slice(src.indexOf("async function monitor"), src.indexOf("async function newsTag"));
  ok(!mon.includes("checkExposure"), "exits/monitoring are never gated by the guard");
});

// ---------------------------------------------------------------- chart patterns
let TT = 1783914300;
const bar = (o, c, w = 0.15, v = 100000) => ({ time: (TT += 300), date: "2026-10-12", clock: "", open: o, high: Math.max(o, c) + w, low: Math.min(o, c) - w, close: c, volume: v });
const wave = (start, wps, per = 6) => { const out = [bar(start, start)]; let p = start; for (const w of wps) { for (let i = 1; i <= per; i++) out.push(bar(out[out.length - 1].close, p + ((w - p) * i) / per)); p = w; } return out; };
const warm = () => Array.from({ length: 30 }, (_, i) => bar(100 + (i % 2 ? 0.3 : -0.3), 100 + (i % 2 ? -0.3 : 0.3)));
const firstFire = (c, id) => { for (let n = 30; n <= c.length; n++) { const r = detectChartPatterns(c.slice(0, n)).filter((x) => x.id === id); if (r.length) return { n, dir: r[0].dir }; } return null; };
await test("Chart patterns: double top fires short, double bottom fires long, only on the breakout bar", () => {
  const top = warm().concat(wave(100, [106, 102, 106, 98, 97, 96], 7)); const a = firstFire(top, "dbl_top");
  ok(a && a.dir === -1, "double top short"); ok(a.n < top.length, "fires before the end of the path");
  const bot = warm().concat(wave(100, [94, 98, 94, 102, 103, 104], 7)); const b = firstFire(bot, "dbl_bottom");
  ok(b && b.dir === 1, "double bottom long");
});
await test("Chart patterns: no look-ahead (appending later bars does not change an earlier result)", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = []; let px = 100; for (let i = 0; i < 300; i++) { const o = px; px += (rnd() - 0.5) * 0.8; noise.push(bar(o, px, 0.1 + rnd() * 0.2)); }
  for (let n = 40; n < 280; n += 11) eq(JSON.stringify(detectChartPatterns(noise.slice(0, n))), JSON.stringify(detectChartPatterns(noise.slice(0, 300).slice(0, n))), `bar ${n}`);
});

// ---------------------------------------------------------------- autopsy classification
const clk = (i) => { const m = 9 * 60 + 15 + i * 5; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const ab = (date, i, o, h, l, c) => ({ time: i, date, clock: clk(i), open: o, high: h, low: l, close: c, volume: 1000 });
const day = (preLevel, path2) => {
  const c = [];
  for (let i = 0; i < 75; i++) c.push(ab("2026-10-13", i, 100, 100.4, 99.6, 100));
  for (let i = 0; i < 15; i++) c.push(ab("2026-10-14", i, preLevel, preLevel + 0.4, preLevel - 0.4, preLevel));
  path2.forEach((p, k) => c.push(ab("2026-10-14", 15 + k, ...p)));
  const last = path2[path2.length - 1][3];
  for (let i = 15 + path2.length; i < 75; i++) c.push(ab("2026-10-14", i, last, last + 0.2, last - 0.2, last));
  return c;
};
const tradeBase = { id: "t", symbol: "T", side: "BUY", dateStr: "2026-10-14", entryClock: "10:30", entry: 100, stopLoss: 99, initialSl: 99, target1: 102 };
await test("Autopsy: a stop hit by a wick that recovers is NOISE_STOP; a straight slide is TREND_AGAINST; a jump through the stop is GAP", () => {
  const noise = autopsyTrade({ ...tradeBase, exitPrice: 99, exitClock: clk(16), reason: "STOP" }, day(100, [[100, 100.3, 99.7, 99.9], [99.9, 100, 98.9, 99.6], [99.6, 100.8, 99.5, 100.7], [100.7, 102.5, 100.6, 102.4]]));
  eq(noise.cause, "NOISE_STOP", "noise");
  const trend = autopsyTrade({ ...tradeBase, exitPrice: 99, exitClock: clk(17), reason: "STOP" }, day(100, [[100, 100.1, 99.6, 99.7], [99.7, 99.8, 99.3, 99.4], [99.4, 99.5, 98.9, 98.8], [98.8, 98.9, 98.2, 98.3]]));
  eq(trend.cause, "TREND_AGAINST", "trend");
  const gap = autopsyTrade({ ...tradeBase, exitPrice: 97.5, exitClock: clk(16), reason: "STOP" }, day(100, [[100, 100.2, 99.8, 100], [97.5, 97.8, 97.2, 97.4], [97.4, 97.6, 97.2, 97.5]]));
  eq(gap.cause, "GAP", "gap");
});
await test("Autopsy: a win has no loss cause, and a time-stop loss is TIME_DECAY, never a noise stop", () => {
  const win = autopsyTrade({ ...tradeBase, exitPrice: 102, exitClock: clk(17), reason: "T1_SERVER" }, day(100, [[100, 100.6, 99.9, 100.5], [100.5, 101.2, 100.4, 101.1], [101.1, 102.2, 101, 102.1]]));
  eq(win.outcome, "WIN", "win"); eq(win.cause, "NONE", "no cause");
  const flat = []; for (let k = 0; k < 6; k++) flat.push([99.95, 100.2, 99.75, 99.95]);
  const dec = autopsyTrade({ ...tradeBase, exitPrice: 99.9, exitClock: clk(20), reason: "TIME_DECAY_TIMEOUT" }, day(100, flat));
  eq(dec.cause, "TIME_DECAY", "decay"); eq(dec.noiseStop, false, "not a noise stop");
});

// ---------------------------------------------------------------- tick-built fallback candles
await test("Tick candles: quotes become 5-min OHLC bars with volume from the cumulative-volume difference", async () => {
  process.chdir(os.tmpdir()); // keep the real data/ folder untouched
  const { recordTick, getTickCandles } = await import("../lib/tickCandles.js");
  const t0 = Math.floor(ist(2026, 10, 22, 10, 0) / 300000) * 300000;
  recordTick("T1", 100, 1000, t0 + 1000); recordTick("T1", 101.5, 1200, t0 + 60000); recordTick("T1", 99.5, 1500, t0 + 120000); recordTick("T1", 100.5, 1800, t0 + 290000);
  recordTick("T1", 100.7, 2000, t0 + 300000 + 5000); recordTick("T1", 102, 2600, t0 + 300000 + 200000);
  const c = getTickCandles("T1");
  eq(c.length, 2, "two bars");
  eq(c[0].open, 100, "open"); eq(c[0].high, 101.5, "high"); eq(c[0].low, 99.5, "low"); eq(c[0].close, 100.5, "close");
  eq(c[0].clock, "10:00", "IST clock"); eq(c[1].clock, "10:05", "next bar");
  eq(c[1].volume, 800, "bar volume = 2600 - 1800");
});
await test("Tick candles: a sampling gap drops the bars before it (no fake continuous series)", async () => {
  const { recordTick, getTickCandles } = await import("../lib/tickCandles.js");
  const t0 = Math.floor(ist(2026, 10, 22, 11, 0) / 300000) * 300000;
  for (const k of [0, 1, 2, 5, 6]) recordTick("T2", 100 + k, 100 * (k + 1), t0 + k * 300000 + 1000); // bars 3 and 4 missing
  const c = getTickCandles("T2");
  eq(c.length, 2, "only the run after the gap");
  eq(c[0].clock, "11:25", "starts after the hole");
});
// ---------------------------------------------------------------- multi-user separation
await test("Users: up to 5 logins, owner keeps data/, others get their own folder, journals never mix", async () => {
  const { loadUsers, userFile, MAX_USERS } = await import("../lib/userScope.js");
  const env = { APP_LOGIN_USER: "Owner", APP_LOGIN_PASSWORD: "p0", APP_USERS: "amit:p1;ravi:p2;neha:p3;sam:p4;extra:p5;owner:dup" };
  const u = loadUsers(env);
  eq(u.length, MAX_USERS, "max 5 users"); eq(u[0].role, "owner", "owner first"); ok(!u.some((x) => x.name === "extra"), "6th user refused");
  process.env.APP_LOGIN_USER = "Owner";
  ok(userFile("owner", "paper-journal.json").endsWith(path.join("data", "paper-journal.json")), "owner file unchanged");
  ok(userFile("amit", "paper-journal.json").includes(path.join("data", "users", "amit")), "amit has own folder");
  ok(userFile("../../etc", "x.json").includes("etc") && !userFile("../../etc", "x.json").includes(".."), "name is sanitised, no path escape");
  const { upsertCall, readJournal } = await import("../lib/journalStore.js");
  const call = { id: "u-1", symbol: "TEST", side: "BUY", entry: 100, dateStr: "2026-10-22", entryClock: "10:00" };
  await upsertCall(call, "ravi");
  eq((await readJournal("ravi")).length, 1, "ravi sees his call");
  eq((await readJournal("amit")).length, 0, "amit does not see ravi's call");
});

const failed = results.filter((r) => !r[1]);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED: ${failed.map((f) => f[0]).join(" | ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
