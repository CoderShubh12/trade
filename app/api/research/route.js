// app/api/research/route.js
// GET /api/research?symbol=SBIN&token=3045
// "Research desk": each analyst is either real data (headlines, Yahoo fundamentals, Angel candles) or a Groq TAG of that real text.
// The Chief summary is plain rules (no LLM, no invented numbers). It is CONTEXT ONLY: it is not a trade signal and has not
// passed any out-of-sample test, so nothing in the trading engine uses it to place or block a trade.
import { NextResponse } from "next/server";
import { GET as newsGET } from "../news/route.js";
import { GET as fundGET } from "../fundamentals/route.js";
import { GET as candlesGET } from "../market-data/route.js";
import { calculateATR } from "../../../lib/indicators";
import { buildCompositeScore } from "../../../lib/signalEngine";
import { getClosedCandles, getSessionInfo } from "../../../lib/sessionUtils";

export const dynamic = "force-dynamic";
const call = async (fn, url) => { try { const r = await fn(new Request(url)); return await r.json(); } catch (e) { return { success: false, error: String(e.message || e) }; } };
const r2 = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);

async function movement(token) {
  const j = await call(candlesGET, `http://local/api/market-data?token=${token}&tf=5`);
  if (!j.success || !Array.isArray(j.data) || j.data.length < 20) return { available: false, reason: j.error || "No candles" };
  const closed = getClosedCandles(j.data, 5, Date.now());
  const { today, previous } = getSessionInfo(closed);
  if (!today.length) return { available: false, reason: "No candles for the latest session" };
  const last = today[today.length - 1], first = today[0];
  const prevClose = previous?.length ? previous[previous.length - 1].close : null;
  const dayHigh = Math.max(...today.map((c) => c.high)), dayLow = Math.min(...today.map((c) => c.low));
  const atr = calculateATR(closed, 14);
  const basis = buildCompositeScore(closed, 5, true);
  const sameBars = previous?.length ? previous.slice(0, today.length).reduce((a, c) => a + c.volume, 0) : null;
  const todayVol = today.reduce((a, c) => a + c.volume, 0);
  const vwap = basis.ind?.latest?.vwap;
  return {
    available: true, stale: !!j.stale, session: last.date, lastClock: last.clock, price: last.close,
    dayChangePct: prevClose ? r2(((last.close - prevClose) / prevClose) * 100) : null,
    gapPct: prevClose ? r2(((first.open - prevClose) / prevClose) * 100) : null,
    rangePos: dayHigh > dayLow ? Math.round(((last.close - dayLow) / (dayHigh - dayLow)) * 100) : null,
    atrPct: atr ? r2((atr / last.close) * 100) : null,
    vwapSide: vwap ? (last.close > vwap ? "above" : "below") : null,
    volVsYesterday: sameBars ? r2(todayVol / sameBars) : null,
    score: Number(basis.score) || 0,
  };
}

function fundamentals(f) {
  if (!f?.success || !f.data) return { available: false, reason: f?.error || "No fundamentals" };
  const notes = f.notes || [];
  const good = notes.filter((n) => n.tone === "good").length, bad = notes.filter((n) => n.tone === "bad").length;
  const d = f.data;
  return { available: true, name: d.name, sector: d.sector, pe: d.pe, roe: d.roe, debtToEquity: d.debtToEquity, revenueGrowth: d.revenueGrowth, earningsGrowth: d.earningsGrowth, analystRating: d.analystRating, notes, good, bad, tilt: good - bad };
}

function chief(news, fund, mv) {
  const flags = [], pros = [], cons = [];
  if (news?.available) {
    if (news.eventRisk === "high") flags.push("High event risk in the news today: expect gaps and sharp moves.");
    if (news.credibility != null && news.credibility < 0.4) flags.push("News credibility is low (rumours or single source): do not lean on the sentiment.");
    if (news.sources != null && news.sources <= 1) flags.push("Only one news source: unconfirmed.");
    if (news.sentiment >= 0.4 && (news.credibility ?? 0.5) >= 0.5) pros.push(`News sentiment positive (${news.sentiment.toFixed(2)})`);
    if (news.sentiment <= -0.4 && (news.credibility ?? 0.5) >= 0.5) cons.push(`News sentiment negative (${news.sentiment.toFixed(2)})`);
    if (news.impactScope === "market") flags.push("The news is market-wide, not specific to this stock.");
  } else flags.push("No news data (not the same as no news).");
  if (fund?.available) {
    if (fund.tilt >= 2) pros.push("Fundamentals look healthy by rule-of-thumb");
    if (fund.tilt <= -2) cons.push("Fundamentals look weak by rule-of-thumb");
  }
  if (mv?.available) {
    if (mv.stale) flags.push("Price data is stale: movement numbers may be old.");
    if (mv.score >= 40 && mv.vwapSide === "above") pros.push(`Price action bullish (score ${mv.score}, above VWAP)`);
    if (mv.score <= -40 && mv.vwapSide === "below") cons.push(`Price action bearish (score ${mv.score}, below VWAP)`);
    if (mv.volVsYesterday != null && mv.volVsYesterday < 0.6) flags.push("Volume is well below yesterday's pace.");
  }
  const lean = pros.length > cons.length ? "BULLISH LEAN" : cons.length > pros.length ? "BEARISH LEAN" : "NEUTRAL / MIXED";
  const label = flags.some((f) => /High event risk|credibility is low/.test(f)) ? `CAUTION · ${lean}` : lean;
  return { label, pros, cons, flags, note: "Context only. Not a trade signal and not validated; it does not place or block any trade." };
}

// Each "bot" = one analyst role from the research-team chart. Status says whether it had real data; verdict is a one-line plain reading.
function bots(news, fund, mv, ch) {
  const ok = !!news?.available;
  const sgn = (v) => (v >= 0.4 ? "positive" : v <= -0.4 ? "negative" : "neutral");
  const B = (id, name, role, source, avail, verdict, why) => ({ id, name, role, source, status: avail ? "ok" : "no data", verdict: avail ? verdict : (why || "no data"), });
  return [
    B("news", "News Research Bot", "Finds today's headlines for the stock", "Google News RSS", ok, `${news?.headlines?.length || 0} headlines from ${news?.sources ?? "?"} source(s)`, news?.reason),
    B("sentiment", "Sentiment Bot", "Reads the tone of those headlines", "Groq tags real text", ok, `${sgn(news?.sentiment)} (${(news?.sentiment ?? 0).toFixed(2)})`, news?.reason),
    B("credibility", "News Credibility Bot", "Rates how trustworthy the set is", "Groq + source count", ok && news?.credibility != null, `${(news?.credibility ?? 0).toFixed(2)} of 1${news?.credibility < 0.4 ? " (LOW: do not lean on it)" : ""}`, "no credibility score"),
    B("impact", "Market Impact Bot", "Says what the news touches and for how long", "Groq tags real text", ok, `${news?.impactScope || "none"} · ${news?.impactHorizon || "none"} · event risk ${news?.eventRisk || "none"}`, news?.reason),
    B("fundamental", "Fundamental Research Bot", "Checks ROE, debt, P/E, growth by rule of thumb", "Yahoo Finance (unofficial)", !!fund?.available, `${fund?.good ?? 0} good / ${fund?.bad ?? 0} weak signals`, fund?.reason),
    B("movement", "Stock Movement Bot", "Reads gap, range, volatility, VWAP, volume", "Angel One candles", !!mv?.available, mv?.available ? `${mv.dayChangePct ?? "?"}% day, ${mv.vwapSide || "?"} VWAP, score ${mv.score}${mv.stale ? " (stale)" : ""}` : "", mv?.reason),
    { id: "chief", name: "Chief Intelligence Bot", role: "Combines the bots with plain rules (context only)", source: "Rules, no AI", status: "ok", verdict: ch.label },
  ];
}

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const symbol = (sp.get("symbol") || "").toUpperCase();
  const token = sp.get("token") || "";
  if (!/^[A-Z0-9&-]{1,15}$/.test(symbol)) return NextResponse.json({ success: false, error: "Bad symbol" }, { status: 400 });
  const [news, fund, mv] = await Promise.all([
    call(newsGET, `http://local/api/news?symbol=${encodeURIComponent(symbol)}`),
    call(fundGET, `http://local/api/fundamentals?symbol=${encodeURIComponent(symbol)}`),
    /^\d{1,10}$/.test(token) ? movement(token) : Promise.resolve({ available: false, reason: "No token given" }),
  ]);
  const fnd = fundamentals(fund);
  const ch = chief(news, fnd, mv);
  return NextResponse.json({ success: true, symbol, asOf: new Date().toISOString(), news, fundamentals: fnd, movement: mv, chief: ch, bots: bots(news, fnd, mv, ch) });
}
