// app/api/my-calls/route.js - "My Calls": the user's OWN predictions, paper-tracked on live Angel quotes with estimated costs.
// GET  -> updates open calls (SL / T1 / 15:15 exit) and returns calls + stats + the stock list. POST {symbol, side, stopLoss, target1, note, qty?}
// POST {close: id} closes a call manually at the live price. Per user (data/my-calls.json for the owner, data/users/<u>/ for others). Paper only.
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { GET as breakoutsGET } from "../breakouts/route.js";
import { STOCK_POOL } from "@/lib/stockPool";
import { roundTripCost, positionSize } from "@/lib/costs";
import { getIstParts } from "@/lib/sessionUtils";
import { requestUser, userFile } from "@/lib/userScope";

export const dynamic = "force-dynamic";
const g = globalThis;
g.__mcQuotes = g.__mcQuotes || { at: 0, q: {} };
const clk = (h) => `${String(Math.floor(h / 100)).padStart(2, "0")}:${String(h % 100).padStart(2, "0")}`;

async function quotes() {
  if (Date.now() - g.__mcQuotes.at < 10000) return g.__mcQuotes.q;
  const j = await (await breakoutsGET()).json();
  if (!j.success) throw new Error(j.error || "quotes failed");
  const q = { ...(j.quotes || {}) }; for (const i of j.indices || []) q[i.token] = { ltp: i.ltp, symbol: i.symbol };
  g.__mcQuotes = { at: Date.now(), q }; return q;
}
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return { calls: [] }; } };
const wr = (f, s) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(s, null, 1)); } catch {} };

function settle(c, ltp, hhmm, force) {
  const dir = c.side === "BUY" ? 1 : -1; let reason = force || null;
  if (!reason) { if (dir === 1 ? ltp <= c.stopLoss : ltp >= c.stopLoss) reason = "SL"; else if (c.target1 > 0 && (dir === 1 ? ltp >= c.target1 : ltp <= c.target1)) reason = "T1"; else if (hhmm >= 1515) reason = "EOD"; }
  if (!reason) return;
  const risk = Math.abs(c.entry - c.stopLoss) * c.qty, gross = (ltp - c.entry) * dir * c.qty;
  c.status = "CLOSED"; c.exit = ltp; c.exitClock = clk(hhmm); c.reason = reason; c.netRs = +(gross - c.costRs).toFixed(2); c.r = risk > 0 ? +(c.netRs / risk).toFixed(2) : 0;
}
function stats(calls) {
  const cl = calls.filter((c) => c.status === "CLOSED"), w = cl.filter((c) => c.r > 0);
  return { total: calls.length, open: calls.length - cl.length, closed: cl.length, wins: w.length, hitRate: cl.length ? +(w.length / cl.length * 100).toFixed(1) : null, netR: +cl.reduce((a, c) => a + c.r, 0).toFixed(2), netRs: +cl.reduce((a, c) => a + (c.netRs || 0), 0).toFixed(0) };
}

export async function GET(request) {
  const file = userFile(requestUser(request), "my-calls.json"), s = rd(file), { hhmm, day } = getIstParts();
  let err = "";
  try {
    const q = await quotes();
    for (const c of s.calls) { if (c.status !== "OPEN") continue; const l = q[c.token]?.ltp; if (l > 0) { c.ltp = l; if (day >= 1 && day <= 5 && hhmm >= 915) settle(c, l, hhmm); } }
    wr(file, s);
  } catch (e) { err = String(e.message || e).slice(0, 100); }
  return NextResponse.json({ success: true, error: err, calls: s.calls.slice().reverse(), stats: stats(s.calls), symbols: STOCK_POOL.map((x) => x.symbol).sort(), paperOnly: true });
}

export async function POST(request) {
  const file = userFile(requestUser(request), "my-calls.json"), s = rd(file), b = await request.json().catch(() => ({})), { hhmm, dateStr, day } = getIstParts();
  if (b.close) {
    const c = s.calls.find((x) => x.id === b.close && x.status === "OPEN"); if (!c) return NextResponse.json({ success: false, error: "call not found" }, { status: 404 });
    const q = await quotes(); const l = q[c.token]?.ltp; if (!(l > 0)) return NextResponse.json({ success: false, error: "no live price" }, { status: 502 });
    settle(c, l, hhmm, "MANUAL"); wr(file, s); return NextResponse.json({ success: true, call: c });
  }
  if (day === 0 || day === 6 || hhmm < 915 || hhmm > 1530) return NextResponse.json({ success: false, error: "Market is closed: calls are tracked on live quotes only during 09:15-15:30 IST" }, { status: 400 });
  const st = STOCK_POOL.find((x) => x.symbol === String(b.symbol || "").toUpperCase());
  const side = b.side === "SELL" ? "SELL" : b.side === "BUY" ? "BUY" : null, sl = Number(b.stopLoss), t1 = Number(b.target1) || 0;
  if (!st || !side || !(sl > 0)) return NextResponse.json({ success: false, error: "symbol (from the list), side and stopLoss are required" }, { status: 400 });
  const q = await quotes(), ltp = q[st.token]?.ltp; if (!(ltp > 0)) return NextResponse.json({ success: false, error: "no live price for this stock" }, { status: 502 });
  if (side === "BUY" ? sl >= ltp : sl <= ltp) return NextResponse.json({ success: false, error: `Stop-loss must be ${side === "BUY" ? "below" : "above"} the live price ${ltp}` }, { status: 400 });
  if (t1 && (side === "BUY" ? t1 <= ltp : t1 >= ltp)) return NextResponse.json({ success: false, error: `Target must be ${side === "BUY" ? "above" : "below"} the live price ${ltp}` }, { status: 400 });
  const qty = Math.floor(Number(b.qty)) > 0 ? Math.floor(Number(b.qty)) : positionSize(100000, 0.5, ltp, sl, 1);
  if (qty < 1) return NextResponse.json({ success: false, error: "quantity would be 0, widen the risk or give qty" }, { status: 400 });
  const c = { id: `${Date.now()}-${st.token}`, symbol: st.symbol, token: String(st.token), side, entry: ltp, stopLoss: sl, target1: t1, qty, costRs: roundTripCost(ltp, qty, side), note: String(b.note || "").slice(0, 200), date: dateStr, entryClock: clk(hhmm), status: "OPEN", paper: true, source: "my-call" };
  s.calls.push(c); wr(file, s);
  return NextResponse.json({ success: true, call: c });
}
