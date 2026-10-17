// lib/safetyBots.js (server only)
// Small safety bots that protect the paper-trading record and the engine. They never place or change a trade.
//   Journal Backup Bot    : copies data/paper-journal.json + data/engine-state.json into data/backups/ (throttled, atomic, pruned)
//   Journal Integrity Bot : finds impossible or inconsistent rows in the journal and reports them
// Everything here is wrapped so a failure can never break the journal or the engine.
import { promises as fs } from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "data");
const BACKUPS = path.join(DATA, "backups");
const FILES = [
  { name: "paper-journal", src: path.join(DATA, "paper-journal.json") },
  { name: "engine-state", src: path.join(DATA, "engine-state.json") },
];
const THROTTLE_MS = 10 * 60 * 1000; // at most one change-snapshot per 10 minutes
const KEEP = 40;                      // newest snapshots kept per file
const g = globalThis;
g.__backupBot = g.__backupBot || { last: 0, lastDay: "", busy: false };

const IST_MS = 5.5 * 3600 * 1000;
const istStamp = (ms = Date.now()) => {
  const d = new Date(ms + IST_MS);
  const p = (n) => String(n).padStart(2, "0");
  return { day: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, full: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}` };
};

// ---------------- Journal Backup Bot ----------------
export async function backupNow(reason = "manual") {
  const B = g.__backupBot;
  if (B.busy) return { skipped: "busy" };
  B.busy = true;
  try {
    await fs.mkdir(BACKUPS, { recursive: true });
    const { full, day } = istStamp();
    const made = [];
    for (const f of FILES) {
      let raw;
      try { raw = await fs.readFile(f.src); } catch { continue; }       // file does not exist yet
      try { JSON.parse(raw.toString("utf8")); } catch { continue; }      // never back up a corrupt file over good ones
      const dst = path.join(BACKUPS, `${f.name}-${full}.json`);
      await fs.writeFile(dst + ".tmp", raw);
      await fs.rename(dst + ".tmp", dst);
      made.push(path.basename(dst));
      // prune: keep newest KEEP per file
      const all = (await fs.readdir(BACKUPS)).filter((x) => x.startsWith(f.name + "-") && x.endsWith(".json")).sort();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await fs.unlink(path.join(BACKUPS, old)).catch(() => {});
    }
    B.last = Date.now(); B.lastDay = day;
    return { made, reason };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    B.busy = false;
  }
}

// Called after every journal write: one snapshot per 10 minutes, and always one per IST day. Never throws, never awaits the caller.
export function maybeBackup(reason = "write") {
  try {
    const B = g.__backupBot;
    const today = istStamp().day;
    if (Date.now() - B.last < THROTTLE_MS && B.lastDay === today) return;
    backupNow(reason).catch(() => {});
  } catch { /* ignore */ }
}

export async function backupStatus() {
  try {
    const files = (await fs.readdir(BACKUPS)).filter((x) => x.endsWith(".json")).sort();
    const latest = {};
    for (const f of FILES) { const mine = files.filter((x) => x.startsWith(f.name + "-")); latest[f.name] = mine.length ? mine[mine.length - 1] : null; }
    return { dir: "data/backups", count: files.length, latest };
  } catch { return { dir: "data/backups", count: 0, latest: {} }; }
}

// ---------------- Journal Integrity Bot ----------------
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clockMin = (c) => (/^\d{1,2}:\d{2}/.test(String(c || "")) ? +String(c).slice(0, 2) * 60 + +String(c).slice(3, 5) : null);

export function checkJournal(list, nowMs = Date.now()) {
  const issues = [];
  const add = (level, code, row, msg) => issues.push({ level, code, id: row?.id || "", symbol: row?.symbol || "", msg });
  if (!Array.isArray(list)) return { ok: false, rows: 0, counts: { error: 1, warn: 0 }, issues: [{ level: "error", code: "NOT_AN_ARRAY", id: "", symbol: "", msg: "Journal is not a list" }] };
  const today = istStamp(nowMs).day;
  const seenId = new Map(), seenKey = new Map();
  for (const r of list) {
    if (!r || typeof r !== "object") { add("error", "BAD_ROW", r, "Row is not an object"); continue; }
    if (seenId.has(r.id)) add("error", "DUP_ID", r, `Duplicate id ${r.id}`); else seenId.set(r.id, true);
    const key = `${r.symbol}|${r.side}|${r.dateStr}|${r.entryClock}|${r.entry}`;
    if (seenKey.has(key) && seenKey.get(key) !== r.id) add("error", "DUP_CALL", r, `Same call stored twice (${seenKey.get(key)} and ${r.id})`); else seenKey.set(key, r.id);
    if (r.side !== "BUY" && r.side !== "SELL") add("error", "BAD_SIDE", r, `side=${r.side}`);
    if (!/^\d{1,10}$/.test(String(r.token ?? ""))) add("warn", "NO_TOKEN", r, "No instrument token (server exit-reconcile cannot fetch candles)");
    const e = num(r.entry), sl = num(r.initialSl ?? r.stopLoss), t1 = num(r.target1);
    if (e === null || e <= 0 || e > 1e6) { add("error", "BAD_ENTRY", r, `entry=${r.entry}`); continue; }
    if (sl !== null && t1 !== null) {
      const ok = r.side === "BUY" ? sl < e && e < t1 : sl > e && e > t1;
      if (!ok) add("error", "BAD_LEVELS", r, `${r.side} levels illogical: sl ${sl}, entry ${e}, t1 ${t1}`);
    }
    const closed = r.exitPrice != null;
    if (!closed) {
      if (r.dateStr && r.dateStr < today) add("warn", "STALE_OPEN", r, `Still open but dated ${r.dateStr} (should have been squared off)`);
      continue;
    }
    const x = num(r.exitPrice);
    if (x === null || x <= 0 || x > 1e6) { add("error", "BAD_EXIT", r, `exitPrice=${r.exitPrice}`); continue; }
    if (!r.exitClock) add("warn", "NO_EXIT_CLOCK", r, "Closed without exit time");
    const a = clockMin(r.entryClock), b = clockMin(r.exitClock);
    if (a !== null && b !== null && b < a) add("error", "EXIT_BEFORE_ENTRY", r, `exit ${r.exitClock} is before entry ${r.entryClock}`);
    if (!r.reason) add("warn", "NO_REASON", r, "Closed without an exit reason");
    if (sl !== null && Math.abs(e - sl) > 0) {
      const want = ((r.side === "BUY" ? 1 : -1) * (x - e)) / Math.abs(e - sl);
      const got = num(r.r);
      if (got === null) add("warn", "NO_R", r, "Closed but r is empty");
      else if (Math.abs(got - want) > 0.25) add("warn", "R_MISMATCH", r, `r=${got} but entry/exit/stop imply ${want.toFixed(2)}`);
      if (got !== null && Math.abs(got) > 10) add("warn", "R_EXTREME", r, `|r|=${Math.abs(got).toFixed(1)}`);
    }
  }
  const counts = { error: issues.filter((i) => i.level === "error").length, warn: issues.filter((i) => i.level === "warn").length };
  return { ok: counts.error === 0, rows: list.length, counts, issues };
}

export async function integrityReport() {
  try {
    const raw = await fs.readFile(FILES[0].src, "utf8").catch(() => "[]");
    return checkJournal(JSON.parse(raw));
  } catch (e) {
    return { ok: false, rows: 0, counts: { error: 1, warn: 0 }, issues: [{ level: "error", code: "UNREADABLE", id: "", symbol: "", msg: String(e.message || e) }] };
  }
}

// ---------------- Data Health Bot ----------------
// Pure rules over a plain snapshot (so it can be unit-tested); getHealth() builds the snapshot from the live process.
const marketOpenIST = (ms) => {
  const d = new Date(ms + IST_MS);
  const dow = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dow >= 1 && dow <= 5 && m >= 9 * 60 + 15 && m <= 15 * 60 + 30;
};

export function evaluateHealth(x) {
  const reasons = [];
  let level = "ok";
  const bump = (to, why) => { reasons.push(why); if (to === "down" || (to === "degraded" && level === "ok")) level = to; };
  if (x.integrityErrors > 0) bump("down", `Journal has ${x.integrityErrors} integrity error(s): new calls are blocked until fixed`);
  if (!x.marketOpen) {
    if (!reasons.length) reasons.push("Market closed: feed checks are off");
    return { level, reasons };
  }
  if (x.candleFails >= 3) bump("down", `Angel candle API refused ${x.candleFails} times in a row`);
  else if (x.candleFails === 2) bump("degraded", "Angel candle API refused twice in a row");
  if (x.candlePauseSec > 0 && x.candleFails >= 2) reasons.push(`candle calls paused for ${Math.round(x.candlePauseSec)}s`);
  if (x.quoteError) bump("degraded", `Price feed error: ${String(x.quoteError).slice(0, 80)}`);
  if (x.tickAgeSec == null) bump("degraded", "No live price tick yet");
  else if (x.tickAgeSec > 60) bump("down", `Newest price tick is ${Math.round(x.tickAgeSec)}s old`);
  else if (x.tickAgeSec > 20) bump("degraded", `Newest price tick is ${Math.round(x.tickAgeSec)}s old`);
  if (!reasons.length) reasons.push("Feed healthy");
  return { level, reasons };
}

function snapshot(nowMs, integrityErrors) {
  const Q = g.__liveQuote;
  let newestTick = 0;
  if (Q && Q.ticks) for (const v of Q.ticks.values()) if (v.ts > newestTick) newestTick = v.ts;
  const pause = Math.max(0, ((g.__candlePauseUntil || 0) - nowMs) / 1000);
  return {
    marketOpen: marketOpenIST(nowMs),
    candleFails: g.__candleFails || 0,
    candlePauseSec: pause,
    quoteError: Q?.error || "",
    tickAgeSec: newestTick ? (nowMs - newestTick) / 1000 : null,
    integrityErrors,
  };
}

// Cached 30s so the engine can call it on every evaluation without re-reading the journal each time.
export async function getHealth({ force = false } = {}) {
  const now = Date.now();
  const c = g.__healthCache;
  if (!force && c && now - c.at < 30000) return c.v;
  const rep = await integrityReport();
  const base = evaluateHealth(snapshot(now, rep.counts.error));
  const eng = g.__engine;
  const v = { ...base, marketOpen: marketOpenIST(now), integrity: { ok: rep.ok, rows: rep.rows, counts: rep.counts }, engineError: eng?.lastError || "" };
  g.__healthCache = { at: now, v };
  return v;
}

// ---------------- Exposure Guard Bot ----------------
// Pure rules (testable). The server engine asks before opening a NEW paper call; exits are never affected. Paper only.
// Nifty "bias score" = Nifty % change from today's open x NIFTY_SCORE_PER_PCT, clamped to -100..100 (0.5% = 25).
export const EXPOSURE = {
  MAX_OPEN: 2,             // simultaneous open paper trades
  MAX_SAME_DIR: 2,         // open trades in the same direction
  STOCK_LOSS_STREAK: 3,    // block a stock whose last N calls today were all losses
  NIFTY_BLOCK_SCORE: 25,   // block a call against Nifty when the bias score is beyond +/- this
  NIFTY_SCORE_PER_PCT: 50,
  MAX_CALLS_PER_DAY: 6,    // new calls per day across all stocks
};

// x = { side:"BUY"|"SELL", open:[{action|side}], callsToday:number, stockResults:["W"|"L"...] (today, oldest first), niftyPct:number|null }
export function checkExposure(x, rules = EXPOSURE) {
  const side = x.side === "SELL" ? "SELL" : "BUY";
  const open = Array.isArray(x.open) ? x.open : [];
  if ((x.callsToday || 0) >= rules.MAX_CALLS_PER_DAY) return { allowed: false, code: "DAY_CAP", reason: `${x.callsToday} calls already today (max ${rules.MAX_CALLS_PER_DAY})` };
  if (open.length >= rules.MAX_OPEN) return { allowed: false, code: "MAX_OPEN", reason: `${open.length} trades already open (max ${rules.MAX_OPEN})` };
  const same = open.filter((t) => (t.action || t.side) === side).length;
  if (same >= rules.MAX_SAME_DIR) return { allowed: false, code: "SAME_DIR", reason: `${same} ${side} trades already open (max ${rules.MAX_SAME_DIR} in one direction)` };
  const r = Array.isArray(x.stockResults) ? x.stockResults : [];
  if (r.length >= rules.STOCK_LOSS_STREAK && r.slice(-rules.STOCK_LOSS_STREAK).every((v) => v === "L")) return { allowed: false, code: "STOCK_STREAK", reason: `last ${rules.STOCK_LOSS_STREAK} calls on this stock today were losses` };
  if (Number.isFinite(x.niftyPct)) {
    const score = Math.max(-100, Math.min(100, x.niftyPct * rules.NIFTY_SCORE_PER_PCT));
    if ((side === "BUY" && score <= -rules.NIFTY_BLOCK_SCORE) || (side === "SELL" && score >= rules.NIFTY_BLOCK_SCORE)) return { allowed: false, code: "NIFTY_AGAINST", reason: `${side} against Nifty (bias score ${score.toFixed(0)}, limit +/-${rules.NIFTY_BLOCK_SCORE})` };
  }
  return { allowed: true, code: "OK", reason: "OK" };
}
