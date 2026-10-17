// app/api/news/route.js
// GET /api/news?symbol=SBIN
// Real headlines (Google News RSS) -> Groq only TAGS them (sentiment, event risk). Groq never sees or invents prices.
// No headlines / no Groq key / any error => { available:false } (the app shows "no data"; it never guesses).
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const MODEL = "openai/gpt-oss-120b";
const TTL = 10 * 60 * 1000;
const g = globalThis;
const CACHE = (g.__newsCache = g.__newsCache || new Map());

const decode = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

async function headlines(symbol) {
  const q = encodeURIComponent(`${symbol} share NSE India`);
  const url = `https://news.google.com/rss/search?q=${q}+when:2d&hl=en-IN&gl=IN&ceid=IN:en`;
  const r = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`news ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
    const t = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const d = (m[1].match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const src = (m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";
    return { title: decode(t).slice(0, 200), published: d, source: decode(src).slice(0, 40) };
  });
  return items.filter((x) => x.title);
}

async function tag(symbol, items) {
  const key = process.env.GROQ_API_KEY || process.env.Groq_API_KEY;
  if (!key) return null;
  const list = items.map((x, i) => `${i + 1}. ${x.title}`).join("\n");
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You tag news headlines for an Indian equity intraday trader. Use ONLY the headlines given. Do not mention prices or predict. Reply with JSON only." },
        { role: "user", content: `Stock: ${symbol}\nHeadlines:\n${list}\n\nReturn JSON: {"sentiment": number from -1 (very negative) to 1 (very positive) for ${symbol} only, "eventRisk": "none"|"low"|"high" (high = results, regulatory action, fraud, block deal, merger, rating change, or other scheduled/major event likely to cause a sharp move today), "credibility": number 0 to 1 (how trustworthy the set is: low for rumours, clickbait, single unverified source, or contradictory stories; high for company filings or several independent outlets agreeing), "impactScope": "stock"|"sector"|"market"|"none" (what the news affects), "impactHorizon": "intraday"|"days"|"long"|"none", "themes": [up to 3 short phrases], "reason": short phrase under 15 words}. If headlines are not about ${symbol}, use sentiment 0, eventRisk "none", impactScope "none".` },
      ],
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const j = await r.json();
  const o = JSON.parse(j.choices?.[0]?.message?.content || "{}");
  const sentiment = Math.max(-1, Math.min(1, Number(o.sentiment) || 0));
  const eventRisk = ["none", "low", "high"].includes(o.eventRisk) ? o.eventRisk : "none";
  const credibility = Math.max(0, Math.min(1, Number(o.credibility)));
  const impactScope = ["stock", "sector", "market", "none"].includes(o.impactScope) ? o.impactScope : "none";
  const impactHorizon = ["intraday", "days", "long", "none"].includes(o.impactHorizon) ? o.impactHorizon : "none";
  const themes = Array.isArray(o.themes) ? o.themes.slice(0, 3).map((x) => String(x).slice(0, 60)) : [];
  return { sentiment, eventRisk, credibility: Number.isFinite(credibility) ? +credibility.toFixed(2) : null, impactScope, impactHorizon, themes, reason: String(o.reason || "").slice(0, 120) };
}

export async function GET(request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
  if (!/^[A-Z0-9&-]{1,15}$/.test(symbol)) return NextResponse.json({ success: false, error: "Bad symbol" }, { status: 400 });
  const hit = CACHE.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.body);
  let body;
  try {
    const items = await headlines(symbol);
    if (!items.length) body = { success: true, available: false, reason: "No recent headlines", headlines: [] };
    else {
      const t = await tag(symbol, items).catch((e) => ({ error: String(e.message || e) }));
      if (t && !t.error) body = { success: true, available: true, ...t, sources: new Set(items.map((x) => x.source).filter(Boolean)).size, headlines: items.slice(0, 5), asOf: new Date().toISOString() };
      else body = { success: true, available: false, reason: t?.error || "Groq key missing", headlines: items.slice(0, 5) };
    }
  } catch (e) {
    body = { success: true, available: false, reason: String(e.message || e), headlines: [] };
  }
  CACHE.set(symbol, { at: Date.now(), body });
  return NextResponse.json(body);
}
