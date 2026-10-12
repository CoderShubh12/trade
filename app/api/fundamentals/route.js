// app/api/fundamentals/route.js
// Fundamentals for an NSE stock from Yahoo Finance (UNOFFICIAL, free, no key).
// Angel One SmartAPI has no fundamentals, so this is a separate source.
// Yahoo can change or block this at any time: the UI shows a clear
// "unavailable" message instead of guessing numbers.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
].join(",");

const CACHE_MS = 6 * 60 * 60 * 1000; // fundamentals change slowly
const resultCache = new Map(); // symbol -> { at, data }
let session = null; // { cookie, crumb, at }

async function getSession(force = false) {
  if (!force && session && Date.now() - session.at < 50 * 60 * 1000) {
    return session;
  }
  // Step 1: this URL answers 404 but sets the cookie we need
  const r1 = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const cookies =
    typeof r1.headers.getSetCookie === "function"
      ? r1.headers.getSetCookie()
      : [r1.headers.get("set-cookie")].filter(Boolean);
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Yahoo did not return a session cookie");

  // Step 2: crumb token
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
    signal: AbortSignal.timeout(10000),
  });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes("<")) {
    throw new Error(`Yahoo crumb request failed (${r2.status})`);
  }
  session = { cookie, crumb, at: Date.now() };
  return session;
}

async function fetchSummary(yahooSymbol, retry = true) {
  const s = await getSession(!retry);
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/` +
    `${encodeURIComponent(yahooSymbol)}?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: s.cookie },
    signal: AbortSignal.timeout(12000),
  });
  if ((res.status === 401 || res.status === 403) && retry) {
    session = null;
    return fetchSummary(yahooSymbol, false);
  }
  if (res.status === 404) return null; // unknown symbol
  if (!res.ok) throw new Error(`Yahoo answered ${res.status}`);
  const json = await res.json();
  return json?.quoteSummary?.result?.[0] || null;
}

// Yahoo wraps numbers as { raw, fmt }
const raw = (o) =>
  o && typeof o === "object" ? (Number.isFinite(o.raw) ? o.raw : null) : Number.isFinite(o) ? o : null;

function normalise(r) {
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  const ap = r.assetProfile || {};
  const pr = r.price || {};
  const pct = (v) => (v === null ? null : v * 100); // 0.153 -> 15.3

  const d = {
    name: pr.longName || pr.shortName || null,
    sector: ap.sector || null,
    industry: ap.industry || null,
    marketCap: raw(pr.marketCap) ?? raw(sd.marketCap),
    price: raw(fd.currentPrice) ?? raw(pr.regularMarketPrice),
    pe: raw(sd.trailingPE),
    forwardPe: raw(sd.forwardPE) ?? raw(ks.forwardPE),
    pb: raw(ks.priceToBook),
    eps: raw(ks.trailingEps),
    dividendYield: pct(raw(sd.dividendYield)),
    beta: raw(sd.beta) ?? raw(ks.beta),
    high52: raw(sd.fiftyTwoWeekHigh),
    low52: raw(sd.fiftyTwoWeekLow),
    roe: pct(raw(fd.returnOnEquity)),
    roa: pct(raw(fd.returnOnAssets)),
    profitMargin: pct(raw(fd.profitMargins)),
    operatingMargin: pct(raw(fd.operatingMargins)),
    revenueGrowth: pct(raw(fd.revenueGrowth)),
    earningsGrowth: pct(raw(fd.earningsGrowth)),
    debtToEquity: raw(fd.debtToEquity), // Yahoo gives this in %, e.g. 85 = 0.85x
    currentRatio: raw(fd.currentRatio),
    totalRevenue: raw(fd.totalRevenue),
    freeCashflow: raw(fd.freeCashflow),
    analystTarget: raw(fd.targetMeanPrice),
    analystRating: fd.recommendationKey || null,
    analystCount: raw(fd.numberOfAnalystOpinions),
  };
  return d;
}

// Simple rule-of-thumb notes. They are NOT part of the intraday score
// and NOT advice. Banks/NBFCs naturally show high debt, so skip that rule.
function buildNotes(d) {
  const notes = [];
  const isFinancial = /bank|financ|insurance|credit/i.test(
    `${d.sector || ""} ${d.industry || ""}`,
  );
  if (d.roe !== null)
    notes.push(
      d.roe >= 15
        ? { tone: "good", text: `ROE ${d.roe.toFixed(1)}% (15%+ is generally healthy)` }
        : d.roe < 8
          ? { tone: "bad", text: `ROE only ${d.roe.toFixed(1)}%` }
          : { tone: "neutral", text: `ROE ${d.roe.toFixed(1)}% is average` },
    );
  if (d.debtToEquity !== null && !isFinancial)
    notes.push(
      d.debtToEquity > 150
        ? { tone: "bad", text: `High debt: debt/equity ${(d.debtToEquity / 100).toFixed(2)}x` }
        : d.debtToEquity < 50
          ? { tone: "good", text: `Low debt: debt/equity ${(d.debtToEquity / 100).toFixed(2)}x` }
          : { tone: "neutral", text: `Debt/equity ${(d.debtToEquity / 100).toFixed(2)}x` },
    );
  if (d.pe !== null)
    notes.push(
      d.pe <= 0
        ? { tone: "bad", text: "Negative earnings (P/E not meaningful)" }
        : d.pe > 60
          ? { tone: "bad", text: `Expensive: P/E ${d.pe.toFixed(1)}` }
          : d.pe < 15
            ? { tone: "good", text: `Cheap vs market: P/E ${d.pe.toFixed(1)} (check why)` }
            : { tone: "neutral", text: `P/E ${d.pe.toFixed(1)}` },
    );
  if (d.revenueGrowth !== null)
    notes.push(
      d.revenueGrowth >= 10
        ? { tone: "good", text: `Revenue growing ${d.revenueGrowth.toFixed(1)}%` }
        : d.revenueGrowth < 0
          ? { tone: "bad", text: `Revenue shrinking ${d.revenueGrowth.toFixed(1)}%` }
          : { tone: "neutral", text: `Revenue growth ${d.revenueGrowth.toFixed(1)}%` },
    );
  if (d.earningsGrowth !== null)
    notes.push(
      d.earningsGrowth >= 10
        ? { tone: "good", text: `Profit growing ${d.earningsGrowth.toFixed(1)}%` }
        : d.earningsGrowth < 0
          ? { tone: "bad", text: `Profit falling ${d.earningsGrowth.toFixed(1)}%` }
          : { tone: "neutral", text: `Profit growth ${d.earningsGrowth.toFixed(1)}%` },
    );
  if (d.price && d.high52 && d.low52 && d.high52 > d.low52) {
    const pos = ((d.price - d.low52) / (d.high52 - d.low52)) * 100;
    notes.push({ tone: "neutral", text: `Trading at ${pos.toFixed(0)}% of its 52-week range` });
  }
  return notes;
}

export async function GET(request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") || "")
    .trim()
    .toUpperCase();

  if (!symbol || symbol.length > 25 || !/^[A-Z0-9&\-]+$/.test(symbol)) {
    return NextResponse.json(
      { success: false, error: "Fundamentals are available for NSE shares only (not indices)." },
      { status: 400 },
    );
  }

  const hit = resultCache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return NextResponse.json({ ...hit.data, cached: true });
  }

  try {
    const r = await fetchSummary(`${symbol}.NS`);
    if (!r) {
      return NextResponse.json({
        success: false,
        error: `Yahoo Finance has no data for ${symbol}.NS`,
      });
    }
    const d = normalise(r);
    const payload = {
      success: true,
      symbol,
      source: "Yahoo Finance (unofficial feed)",
      fetchedAt: new Date().toISOString(),
      data: d,
      notes: buildNotes(d),
    };
    resultCache.set(symbol, { at: Date.now(), data: payload });
    return NextResponse.json(payload);
  } catch (err) {
    // Serve an older copy if we have one, otherwise say plainly it failed.
    if (hit) return NextResponse.json({ ...hit.data, cached: true, stale: true });
    return NextResponse.json({
      success: false,
      error: `Fundamentals unavailable right now (${err.message}).`,
    });
  }
}
