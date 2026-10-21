// app/api/market-data/route.js
// Candles from Angel One getCandleData, protected against Angel's rate limit (403/429):
//  - one shared request per token+timeframe at a time (single-flight)
//  - short cache, and if Angel fails the last good candles are served (flagged stale)
//  - all Angel calls go through one queue, spaced apart
import { NextResponse } from "next/server";
import axios from "axios";
import { getAngelSession, resetAngelSession } from "@/lib/angelAuth";

export const dynamic = "force-dynamic";

const g = globalThis;
g.__candleCache = g.__candleCache || new Map(); // key -> { data, timestamp }
g.__candleInflight = g.__candleInflight || new Map(); // key -> Promise
g.__angelQueueTail = g.__angelQueueTail || Promise.resolve();
g.__angelLastCall = g.__angelLastCall || 0;

const FRESH_MS = 12000; // serve from cache this long
const STALE_OK_MS = 180000; // on Angel errors, serve older data up to 3 min (flagged)
const MIN_GAP_MS = 700; // Angel allows ~3 historical calls/second; stay under it

const INTERVAL_MAP = { 1: "ONE_MINUTE", 3: "THREE_MINUTE", 5: "FIVE_MINUTE", 15: "FIFTEEN_MINUTE" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn after all earlier Angel calls, at least MIN_GAP_MS after the previous one.
function queued(fn) {
  const run = g.__angelQueueTail.then(async () => {
    const wait = g.__angelLastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      g.__angelLastCall = Date.now();
    }
  });
  g.__angelQueueTail = run.catch(() => {});
  return run;
}

const pad = (n) => String(n).padStart(2, "0");
// Always build Angel date ranges in IST (Vercel runs in UTC).
const IST_MS = 5.5 * 60 * 60 * 1000;
const istParts = (d) => { const x = new Date(d.getTime() + IST_MS); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() }; };
const fmtDay = (d) => { const p = istParts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };

async function callAngel(session, token, intervalStr) {
  const now = new Date();
  const past = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // covers weekends/holidays
  const body = {
    exchange: "NSE",
    symboltoken: String(token),
    interval: intervalStr,
    fromdate: `${fmtDay(past)} 09:15`,
    todate: `${fmtDay(now)} ${pad(istParts(now).h)}:${pad(istParts(now).mi)}`,
  };
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${session.jwtToken}`,
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "fe80::1",
    "X-PrivateKey": session.apiKey,
  };
  const url = "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData";
  return axios.post(url, body, { headers, timeout: 8000 });
}

g.__candlePauseUntil = g.__candlePauseUntil || 0;

async function fetchCandles(token, tf) {
  if (Date.now() < g.__candlePauseUntil) throw Object.assign(new Error("Angel rate limit: pausing candle calls briefly"), { paused: true });
  const intervalStr = INTERVAL_MAP[tf] || "FIVE_MINUTE";
  const session = await getAngelSession();
  if (!session?.jwtToken) throw Object.assign(new Error("Angel One session failed. Check .env.local credentials."), { status: 401 });

  let res;
  try {
    res = await queued(() => callAngel(session, token, intervalStr));
  } catch (e) {
    const code = e.response?.status;
    if (code === 403 || code === 429) {
      // Escalating back-off: 10s, 20s, 40s, then 60s while Angel keeps refusing; resets on the first success.
      g.__candleFails = (g.__candleFails || 0) + 1;
      g.__candlePauseUntil = Date.now() + Math.min(60000, 10000 * 2 ** (g.__candleFails - 1));
      // 2+ refusals in a row may mean the cached login is dead, not just a rate limit: force a fresh login (max once / 2 min).
      if (g.__candleFails >= 2) resetAngelSession();
      throw e;
    }
    if (e.code === "ECONNABORTED") {
      await sleep(900); // one polite retry
      res = await queued(() => callAngel(session, token, intervalStr));
    } else throw e;
  }
  g.__candleFails = 0;
  const raw = res.data?.data;
  if (!(res.data?.status && Array.isArray(raw) && raw.length > 0)) {
    throw Object.assign(new Error(res.data?.message || "No candle data returned from exchange."), { empty: true });
  }
  // Drop placeholder candles (zero volume and flat O=H=L=C, e.g. the 15:25 closing stub) - they draw a junk wick and skew indicators.
  return raw.filter((b) => !(Number(b[5]) === 0 && b[1] === b[2] && b[2] === b[3] && b[3] === b[4])).map((b) => {
    const ts = String(b[0]);
    return {
      time: Math.floor(new Date(ts).getTime() / 1000),
      date: ts.slice(0, 10),
      clock: ts.slice(11, 16),
      open: Number(b[1]), high: Number(b[2]), low: Number(b[3]), close: Number(b[4]),
      volume: Number(b[5]) || 1,
    };
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "3045";
  const tf = searchParams.get("tf") || searchParams.get("interval") || "5";
  const key = `${token}_${tf}`;
  const cached = g.__candleCache.get(key);

  if (cached && Date.now() - cached.timestamp < FRESH_MS) {
    return NextResponse.json({ success: true, data: cached.data, cached: true });
  }

  let flight = g.__candleInflight.get(key);
  if (!flight) {
    flight = fetchCandles(token, tf)
      .then((data) => {
        g.__candleCache.set(key, { data, timestamp: Date.now() });
        return data;
      })
      .finally(() => g.__candleInflight.delete(key));
    g.__candleInflight.set(key, flight);
  }

  try {
    const data = await flight;
    return NextResponse.json({ success: true, data, source: "ANGEL_ONE_LIVE" });
  } catch (error) {
    console.error("Angel API Error:", error.response?.status || "", error.response?.data || error.message);
    if (cached && Date.now() - cached.timestamp < STALE_OK_MS) {
      return NextResponse.json({
        success: true, data: cached.data, stale: true,
        staleSeconds: Math.round((Date.now() - cached.timestamp) / 1000),
        warning: error.message,
      });
    }
    return NextResponse.json(
      { success: false, error: error.response?.data?.message || error.message, data: [] },
      { status: error.status === 401 ? 401 : 500 },
    );
  }
}
