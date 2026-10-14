// lib/journalReconcile.js
// Fills in exits for paper calls that have none (browser tab closed, app restarted, etc.).
// Uses real 5m candles from the same server route. Conservative: stop is checked before target in a bar;
// it uses the INITIAL stop and target 1 (no trailing), so it is an approximation and is tagged source:"server".
// Only touches calls from a past day, or from today once the market is over (>= 15:35 IST),
// so it never fights with a live browser tab that is still managing the trade.
import { promises as fs } from "fs";
import path from "path";
import { GET as candlesGET } from "../app/api/market-data/route.js";

const IST = 5.5 * 3600 * 1000;
const istNow = () => { const d = new Date(Date.now() + IST); return { day: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };

async function tokenFor(t) {
  if (t.token) return String(t.token);
  try {
    const f = path.join(process.cwd(), "data", "movers", "5m", `${t.symbol}_5m.json`);
    const m = JSON.parse(await fs.readFile(f, "utf8")).meta || {};
    return String(m.token || m.symbolToken || "") || null;
  } catch { return null; }
}

function decide(t, candles) {
  const long = t.side === "BUY";
  const sl = t.initialSl ?? t.stopLoss, t1 = t.target1;
  const risk = Math.abs(t.entry - sl);
  if (!(risk > 0)) return null;
  const rows = candles.filter((c) => c.date === t.dateStr && c.clock >= t.entryClock);
  if (!rows.length) return null;
  const mk = (px, clock, reason) => ({ exitPrice: +px.toFixed(2), exitClock: clock, reason, r: +(((long ? px - t.entry : t.entry - px)) / risk).toFixed(3), source: "server" });
  for (const c of rows) {
    if (c.clock > "15:25") break;
    if (long ? c.low <= sl : c.high >= sl) return mk(sl, c.clock, "STOP_SERVER");
    if (t1 && (long ? c.high >= t1 : c.low <= t1)) return mk(t1, c.clock, "T1_SERVER");
  }
  const eod = [...rows].reverse().find((c) => c.clock <= "15:15");
  const last = rows[rows.length - 1];
  if (last && last.clock >= "15:25" && eod) return mk(eod.close, eod.clock, "EOD_SERVER");
  return null; // day not finished yet
}

export async function reconcileOpen(list) {
  const { day, hm } = istNow();
  const out = [];
  const cache = new Map();
  for (const t of list) {
    if (t.exitPrice != null || !t.entry) continue;
    if (!(t.dateStr < day || hm >= "15:35")) continue;
    const tok = await tokenFor(t);
    if (!tok) continue;
    try {
      if (!cache.has(tok)) {
        const res = await candlesGET(new Request(`http://local/api/market-data?token=${tok}&tf=5`));
        const j = await res.json();
        cache.set(tok, Array.isArray(j.data) ? j.data : []);
      }
      const d = decide(t, cache.get(tok));
      if (d) out.push({ id: t.id, ...d });
    } catch { /* leave open; try next time */ }
  }
  return out;
}
