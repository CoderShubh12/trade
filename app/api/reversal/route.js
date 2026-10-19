// app/api/reversal/route.js
// GET -> samples NIFTY and BANKNIFTY from the live feed, runs lib/reversalBot.js, returns today's alerts (kept in memory + data/reversal-alerts.json).
// Alert only. It runs whenever the dashboard (or any caller) polls it, so keep /dashboard open during market hours.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getTicks } from "@/lib/liveFeed";
import { newRevState, updateReversal, istDay } from "@/lib/reversalBot";

export const dynamic = "force-dynamic";
const FILE = path.join(process.cwd(), "data", "reversal-alerts.json");
const INDEX = { NIFTY: "99926000", BANKNIFTY: "99926009" };
const g = globalThis;
g.__rev = g.__rev || { st: { NIFTY: newRevState(), BANKNIFTY: newRevState() }, alerts: [], day: "", last: {}, loaded: false };

async function load(R) {
  if (R.loaded) return;
  R.loaded = true;
  try { const j = JSON.parse(await fs.readFile(FILE, "utf8")); if (j.day === istDay(Date.now())) { R.alerts = j.alerts || []; R.day = j.day; } } catch { /* none yet */ }
}

export async function GET() {
  const R = g.__rev;
  await load(R);
  const now = Date.now(), day = istDay(now);
  if (R.day !== day) { R.day = day; R.alerts = []; }
  const mins = new Date(now + 330 * 60000);
  const hm = mins.getUTCHours() * 100 + mins.getUTCMinutes(), open = mins.getUTCDay() >= 1 && mins.getUTCDay() <= 5 && hm >= 915 && hm <= 1530;
  let fresh = [];
  if (open) {
    try {
      const t = await getTicks(Object.values(INDEX));
      for (const [name, tok] of Object.entries(INDEX)) {
        const tick = t?.ticks?.[tok];
        if (!tick || !(tick.ltp > 0) || tick.ageMs > 120000) continue;
        R.last[name] = tick.ltp;
        const a = updateReversal(R.st[name], now, tick.ltp);
        if (a) { const rec = { ...a, index: name, clock: mins.toISOString().slice(11, 16) }; R.alerts.push(rec); fresh.push(rec); }
      }
    } catch { /* feed hiccup: skip this sample */ }
    if (fresh.length) { try { await fs.mkdir(path.dirname(FILE), { recursive: true }); await fs.writeFile(FILE, JSON.stringify({ day, alerts: R.alerts }, null, 1)); } catch { /* ignore */ } }
  }
  const s = R.st;
  return NextResponse.json({ success: true, day, marketOpen: open, alerts: R.alerts.slice(-20), fresh, last: R.last,
    range: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { high: v.high, low: v.low }])),
    note: "Alert only. Replay on 63 days: the index did NOT continue in the alert direction (30-min move about -0.03%, both halves). Use as a heads-up, not an entry." });
}
