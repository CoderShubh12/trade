// lib/patternWatch.js - scans the stock pool (Yahoo 5m candles) every 3 min during market hours and records NEW double-bottom (W) / double-top (M)
// events from lib/signalPoints.js. "W?"/"M?" = pattern forming (watch), "W"/"M" = neckline closed beyond. Alerts only; no orders, no edge claim:
// these rules did not pass our out-of-sample tests (see analysis/).
import { STOCK_POOL } from "@/lib/stockPool";
import { getYahooCandles } from "@/lib/yahooCandles";
import { signalPoints } from "@/lib/signalPoints";

const g = globalThis;
g.__pw = g.__pw || { timer: null, busy: false, alerts: [], seen: new Set(), lastScan: 0, lastError: "", scanned: 0, failed: 0, ver: 0 };
const VER = 1, IST = 5.5 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scan() {
  const G = g.__pw; if (G.busy) return; G.busy = true;
  try {
    const now = new Date(Date.now() + IST), hhmm = now.getUTCHours() * 100 + now.getUTCMinutes(), dow = now.getUTCDay();
    if (dow === 0 || dow === 6 || hhmm < 935 || hhmm > 1520) return;
    const today = now.toISOString().slice(0, 10); let ok = 0, bad = 0;
    for (const s of STOCK_POOL.filter((x) => x.baseBand !== "INDEX")) {
      try {
        const bars = await getYahooCandles(s.token, "5"); ok++;
        const last = bars[bars.length - 1]; if (!last || last.date !== today) continue;
        const idx = new Map(bars.map((b, i) => [`${b.date} ${b.clock}`, i])), lastI = bars.length - 1;
        for (const p of signalPoints(bars)) {
          if (!["W", "M", "W?", "M?"].includes(p.rule)) continue;
          const i = idx.get(p.key); if (i == null || lastI - i > 2) continue; // only fresh (last 2 bars = ~10 min)
          const id = `${s.symbol}|${p.key}|${p.rule}`; if (G.seen.has(id)) continue; G.seen.add(id);
          G.alerts.push({ id, t: Date.now(), symbol: s.symbol, token: s.token, side: p.side, rule: p.rule, confirmed: !p.rule.endsWith("?"), price: p.price, barTime: p.key, why: p.why });
          if (G.alerts.length > 150) G.alerts.shift();
        }
      } catch { bad++; }
      await sleep(250);
    }
    G.scanned = ok; G.failed = bad; G.lastScan = Date.now(); G.lastError = ok ? "" : "No Yahoo candles (market closed or blocked)";
  } catch (e) { g.__pw.lastError = String(e.message || e).slice(0, 100); }
  finally { g.__pw.busy = false; }
}
export function ensurePatternWatch() {
  const G = g.__pw;
  if (G.timer && G.ver !== VER) { clearInterval(G.timer); G.timer = null; }
  if (!G.timer) { G.ver = VER; G.timer = setInterval(scan, 180000); setTimeout(scan, 2000); }
}
export function patternStatus() { const G = g.__pw; return { running: !!G.timer, lastScan: G.lastScan, scanned: G.scanned, failed: G.failed, error: G.lastError, alerts: G.alerts.slice().reverse() }; }
