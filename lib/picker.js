// lib/picker.js - "Stock Picker": sector strength -> stock strength -> same-time-of-day relative volume -> day-high breakout -> news flags.
// All inputs are real (Angel quotes, our own 5m volume history, Google News RSS headlines). It RANKS a watchlist; it does not predict. Paper only.
// Each day's top picks are logged so a forward 1-day record builds up (analysis found no proven edge in any component).
import axios from "axios";
import fs from "fs";
import path from "path";
import { STOCK_POOL } from "@/lib/stockPool";
import { sectorOf } from "@/lib/sectors";
import { getAngelSession } from "@/lib/angelAuth";
import { getYahooDaily } from "@/lib/yahooCandles";

const LOG = path.join(process.cwd(), "data", "picker-log.json"), IST = 5.5 * 3600e3, g = globalThis;
g.__picker = g.__picker || { at: 0, data: null, busy: null, news: new Map(), vcurve: new Map() };
const P = g.__picker, readLog = () => { try { return JSON.parse(fs.readFileSync(LOG, "utf8")); } catch { return { entries: [] }; } };
const POS = /(surge|jump|rall|soar|gain|beat|record|upgrade|order win|bags? order|wins? order|profit (rises|jumps|up)|buyback|dividend|approval|launch|partnership|stake buy|raises? target|outperform)/i;
const NEG = /(fall|slump|plunge|drop|miss|downgrade|probe|fraud|penalty|fine|loss|cut|resign|raid|default|recall|ban|lawsuit|sell-?off|weak|underperform)/i;
const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function news(sym) {
  const hit = P.news.get(sym); if (hit && Date.now() - hit.at < 10 * 60000) return hit.v;
  let v = { items: [], pos: 0, neg: 0 };
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(sym + " share NSE")}+when:1d&hl=en-IN&gl=IN&ceid=IN:en`, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await r.text();
    v.items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map((m) => dec((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").slice(0, 140)).filter(Boolean);
    for (const t of v.items) { if (POS.test(t)) v.pos++; if (NEG.test(t)) v.neg++; }
  } catch {}
  P.news.set(sym, { at: Date.now(), v }); return v;
}

// expected cumulative volume by now, from our own local 5m history (only stocks with a file in data/movers/5m; else null)
function expectedVol(sym, nowClock) {
  const k = sym + nowClock.slice(0, 4); if (P.vcurve.has(k)) return P.vcurve.get(k);
  let v = null;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "movers", "5m", `${sym}_5m.json`), "utf8")).candles, by = {};
    for (const b of c) if (b.clock <= nowClock) by[b.date] = (by[b.date] || 0) + (b.volume || 0);
    const days = Object.values(by).filter((x) => x > 0); if (days.length >= 20) v = days.reduce((a, b) => a + b, 0) / days.length;
  } catch {}
  P.vcurve.set(k, v); return v;
}

async function quotes() {
  const s = await getAngelSession(), rows = [], pool = STOCK_POOL.filter((x) => x.baseBand !== "INDEX");
  for (let i = 0; i < pool.length; i += 50) {
    const res = await axios.post("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/", { mode: "FULL", exchangeTokens: { NSE: pool.slice(i, i + 50).map((x) => String(x.token)) } },
      { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": s.apiKey }, timeout: 9000 });
    rows.push(...(res.data?.data?.fetched || []));
  }
  const sym = new Map(pool.map((x) => [String(x.token), x.symbol]));
  return rows.map((r) => { const ltp = +r.ltp, hi = +r.high, lo = +r.low, pc = +r.close; return { symbol: sym.get(String(r.symbolToken)), token: String(r.symbolToken), ltp, chgPct: pc > 0 ? (ltp / pc - 1) * 100 : null, offHighPct: hi > 0 ? (1 - ltp / hi) * 100 : null, rangePos: hi > lo ? (ltp - lo) / (hi - lo) : null, vol: +r.tradeVolume || 0, to52wHighPct: +r["52WeekHigh"] > 0 ? (1 - ltp / +r["52WeekHigh"]) * 100 : null }; })
    .filter((x) => x.symbol && x.ltp > 0 && x.chgPct != null);
}

export async function runPicker(force = false) {
  if (!force && P.data && Date.now() - P.at < 60000) return P.data; if (P.busy) return P.busy;
  P.busy = (async () => {
    const q = await quotes(), now = new Date(Date.now() + IST), clock = now.toISOString().slice(11, 16), today = now.toISOString().slice(0, 10);
    const by = {}; for (const x of q) (by[sectorOf(x.symbol)] ||= []).push(x);
    const sectors = Object.entries(by).filter(([k, l]) => k !== "OTHER" && l.length >= 2).map(([k, l]) => ({ sector: k, n: l.length, avgChgPct: +(l.reduce((a, x) => a + x.chgPct, 0) / l.length).toFixed(2), breadthPct: Math.round(100 * l.filter((x) => x.chgPct > 0).length / l.length) })).sort((a, b) => b.avgChgPct - a.avgChgPct);
    const sMap = Object.fromEntries(sectors.map((s) => [s.sector, s]));
    const rows = q.map((x) => {
      const sec = sMap[sectorOf(x.symbol)], exp = expectedVol(x.symbol, clock), rvol = exp ? +(x.vol / exp).toFixed(2) : null;
      const why = []; let sc = 0;
      if (sec) { const t = Math.max(-1, Math.min(1, sec.avgChgPct / 1.5)) * 20; sc += t; if (sec.avgChgPct > 0.3 && sec.breadthPct >= 60) why.push(`sector ${sec.sector} strong (${sec.avgChgPct}%, ${sec.breadthPct}% up)`); }
      const rel = sec ? x.chgPct - sec.avgChgPct : 0; sc += Math.max(-1, Math.min(1, x.chgPct / 3)) * 25; if (rel > 0.5) why.push(`beats its sector by ${rel.toFixed(1)}%`);
      if (rvol != null) { sc += Math.min(1.5, rvol) / 1.5 * 20; if (rvol >= 1.5) why.push(`volume ${rvol}x normal for this time`); }
      if (x.offHighPct != null) { sc += Math.max(0, 1 - x.offHighPct / 1) * 15; if (x.offHighPct <= 0.25) why.push("at day high"); }
      if (x.to52wHighPct != null && x.to52wHighPct <= 3) { sc += 5; why.push(`within ${x.to52wHighPct.toFixed(1)}% of 52-week high`); }
      return { symbol: x.symbol, token: x.token, sector: sectorOf(x.symbol), ltp: x.ltp, chgPct: +x.chgPct.toFixed(2), rvol, offHighPct: x.offHighPct == null ? null : +x.offHighPct.toFixed(2), score: Math.round(sc), why };
    }).sort((a, b) => b.score - a.score);
    const top = rows.slice(0, 8);
    await Promise.all(top.map(async (t) => { const n = await news(t.symbol); t.news = n.items.slice(0, 2); t.newsPos = n.pos; t.newsNeg = n.neg; if (n.pos > n.neg) { t.score += 5; t.why.push("positive-keyword headline"); } if (n.neg > n.pos) { t.score -= 8; t.why.push("NEGATIVE-keyword headline: read it first"); } }));
    top.sort((a, b) => b.score - a.score);
    // forward log: top 5 once per day after 15:00 IST (price at the close); evaluated next sessions on Yahoo daily closes
    const log = readLog();
    if (clock >= "15:00" && clock <= "15:45" && !log.entries.some((e) => e.date === today)) { log.entries.push(...top.slice(0, 5).map((t) => ({ date: today, symbol: t.symbol, token: t.token, ltp: t.ltp }))); try { fs.writeFileSync(LOG, JSON.stringify(log)); } catch {} }
    const r1 = []; for (const e of log.entries.filter((e) => e.date < today).slice(-60)) { try { const d = await getYahooDaily(e.token), i = d.findIndex((x) => x.date === e.date); if (i >= 0 && d[i + 1]) r1.push(d[i + 1].close / e.ltp - 1 - 0.001); } catch {} }
    const fwd = { n: r1.length, avg1dPct: r1.length ? +(100 * r1.reduce((a, b) => a + b, 0) / r1.length).toFixed(3) : null, loggedDays: new Set(log.entries.map((e) => e.date)).size };
    P.data = { success: true, asOf: now.toISOString(), clock, sectors, top, forward: fwd, volumeNote: "Relative volume uses our own 63-day 5m history (44 stocks); others show no volume ratio.",
      note: "Ranks a watchlist from sector strength, stock strength, same-time volume, day-high breakout and headline keywords. It does not predict which stock will rise: our tests found no proven edge in any of these. News flags are keyword matches, not sentiment. Paper only." };
    P.at = Date.now(); return P.data;
  })().finally(() => { P.busy = null; });
  return P.busy;
}
