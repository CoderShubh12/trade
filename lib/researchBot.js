// lib/researchBot.js - PAPER-ONLY research bot (owner, separate from the engine and its risk guards).
// Every 15 min (09:30-14:45 IST) it takes up to 3 top candidates from /api/research (score >= 60) and opens simulated trades,
// then tracks them on 60-s live quotes: exit at SL, T1, or 15:15. Result R is NET of estimated costs. Purpose: collect out-of-sample
// data. Polling every 60 s can miss intrabar wicks, and the fills are the observed LTP (so slippage is included). Not a profit claim.
import fs from "fs";
import path from "path";
import { GET as breakoutsGET } from "@/app/api/breakouts/route.js";
import { GET as researchGET } from "@/app/api/research/route.js";
import { getIstParts } from "@/lib/sessionUtils";

const g = globalThis;
g.__rbot = g.__rbot || { timer: null, busy: false, slotDone: "", lastTick: 0, lastError: "" };
const FILE = path.join(process.cwd(), "data", "research-trades.json");
const CAP = Number(process.env.RB_CAPITAL || 100000), RISK = Number(process.env.RB_RISK_PCT || 0.5);
const MAX_PER_SLOT = 3, MAX_OPEN = 8;
const clk = (h) => `${String(Math.floor(h / 100)).padStart(2, "0")}:${String(h % 100).padStart(2, "0")}`;

function load(day) {
  try { const j = JSON.parse(fs.readFileSync(FILE, "utf8")); if (j.day === day) return j; } catch {}
  return { day, trades: [] };
}
const save = (s) => { try { fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); } catch {} };

export function status() {
  const { dateStr } = getIstParts();
  const s = load(dateStr), closed = s.trades.filter((t) => t.status === "CLOSED");
  const netR = closed.reduce((a, t) => a + t.r, 0), wins = closed.filter((t) => t.r > 0).length;
  return { day: dateStr, running: !!g.__rbot.timer, lastTick: g.__rbot.lastTick, lastError: g.__rbot.lastError, total: s.trades.length, open: s.trades.filter((t) => t.status === "OPEN").length, closed: closed.length, wins, netR: +netR.toFixed(2), netRs: +closed.reduce((a, t) => a + (t.netRs || 0), 0).toFixed(0), trades: s.trades.slice().reverse() };
}

async function tick() {
  if (g.__rbot.busy) return; g.__rbot.busy = true;
  try {
    const { dateStr, day, hhmm } = getIstParts();
    if (day === 0 || day === 6 || hhmm < 930 || hhmm > 1530) return;
    const s = load(dateStr);
    const bj = await (await breakoutsGET()).json();
    if (!bj.success) throw new Error(bj.error || "quotes failed");
    const q = bj.quotes || {};
    // 1) manage open trades
    for (const t of s.trades) {
      if (t.status !== "OPEN") continue;
      const ltp = q[t.token]?.ltp; if (!(ltp > 0)) continue;
      const dir = t.side === "BUY" ? 1 : -1; let reason = null;
      if (dir === 1 ? ltp <= t.stopLoss : ltp >= t.stopLoss) reason = "SL";
      else if (dir === 1 ? ltp >= t.target1 : ltp <= t.target1) reason = "T1";
      else if (hhmm >= 1515) reason = "EOD";
      if (!reason) continue;
      const risk = Math.abs(t.entry - t.stopLoss) * t.qty;
      const gross = (ltp - t.entry) * dir * t.qty;
      t.status = "CLOSED"; t.exit = ltp; t.exitClock = clk(hhmm); t.reason = reason;
      t.netRs = +(gross - t.costRs).toFixed(2); t.r = +(t.netRs / risk).toFixed(2);
    }
    // 2) new trades on each 15-min slot (09:30-14:45), catching a slot up to 10 min late
    const slotHh = Math.floor(hhmm / 100) * 100 + Math.floor((hhmm % 100) / 15) * 15, late = (hhmm % 100) - (slotHh % 100);
    const key = `${dateStr} ${slotHh}`;
    if (slotHh >= 930 && slotHh <= 1445 && late <= 10 && g.__rbot.slotDone !== key && !s.trades.some((t) => t.slot === key)) {
      g.__rbot.slotDone = key;
      const rj = await (await researchGET(new Request(`http://local/api/research?capital=${CAP}&riskPct=${RISK}`))).json();
      let openN = s.trades.filter((t) => t.status === "OPEN").length, added = 0;
      for (const c of rj.ranked || []) {
        if (added >= MAX_PER_SLOT || openN >= MAX_OPEN) break;
        if (s.trades.some((t) => t.status === "OPEN" && t.token === c.token)) continue;
        s.trades.push({ id: `${key}-${c.token}`, slot: key, symbol: c.symbol, token: c.token, side: c.side, entryClock: clk(hhmm), entry: c.ltp, stopLoss: c.stopLoss, target1: c.target1, target2: c.target2, qty: c.qty, costRs: c.costRs, score: c.score, why: c.met, market: rj.market.trend, status: "OPEN", source: "research15", paper: true });
        openN++; added++;
      }
    }
    save(s); g.__rbot.lastTick = Date.now(); g.__rbot.lastError = "";
  } catch (e) { g.__rbot.lastError = String(e.message || e).slice(0, 120); }
  finally { g.__rbot.busy = false; }
}

export function ensureRunning() {
  if (!g.__rbot.timer) { g.__rbot.timer = setInterval(tick, 60000); setTimeout(tick, 1500); }
}
