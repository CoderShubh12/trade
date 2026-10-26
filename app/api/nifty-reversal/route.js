// app/api/nifty-reversal/route.js - Nifty 5m trace + causal reversal events + recent market headlines (Google News RSS, keyword flags only).
// Heads-up only: replay of the older tick-based bot found no continuation after reversal alerts.
import { NextResponse } from "next/server";
import { getYahooCandles } from "@/lib/yahooCandles";
import { getAngelNifty5m } from "@/lib/angelNifty";
import { niftyReversals } from "@/lib/niftyReversal";

export const dynamic = "force-dynamic";
const g = globalThis;
const NEWS = (g.__niftyNews = g.__niftyNews || { at: 0, items: [] });
const KEYS = /(rbi|fed|rate cut|rate hike|inflation|tariff|war|crude|oil|gdp|results|earnings|fii|fpi|sell-?off|crash|rally|ceasefire|budget|election|sebi|gift nifty)/i;
const dec = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function news() {
  if (Date.now() - NEWS.at < 5 * 60000) return NEWS.items;
  try {
    const r = await fetch("https://news.google.com/rss/search?q=Nifty+Sensex+today+when:1d&hl=en-IN&gl=IN&ceid=IN:en", { signal: AbortSignal.timeout(7000), headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await r.text();
    NEWS.items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
      const t = dec((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""), d = (m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "", s = dec((m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "");
      const ageMin = d ? Math.round((Date.now() - new Date(d).getTime()) / 60000) : null;
      return { title: t.slice(0, 180), source: s.slice(0, 40), ageMin, keyword: (t.match(KEYS) || [])[0] || null };
    }).filter((x) => x.title);
    NEWS.at = Date.now();
  } catch { NEWS.at = Date.now() - 4 * 60000; } // retry in a minute
  return NEWS.items;
}

export async function GET() {
  try {
    let all, source = "ANGEL", warn = null;
    try { all = await getAngelNifty5m(); } catch (e) { warn = String(e.message || e); source = "YAHOO"; all = await getYahooCandles("99926000", "5"); }
    const ev = niftyReversals(all);
    const today = all[all.length - 1].date;
    const bars = all.filter((b) => b.date === today);
    const items = await news();
    return NextResponse.json({ success: true, dataAt: new Date().toISOString(), source, warn, lastBar: bars[bars.length - 1]?.clock, date: today, bars, events: ev.filter((e) => e.key.startsWith(today)), news: items, note: "Heads-up only. Replay of the older reversal bot showed no continuation in the alert direction. News flags are keyword matches, not sentiment." });
  } catch (e) { return NextResponse.json({ success: false, error: String(e.message || e) }, { status: 502 }); }
}
