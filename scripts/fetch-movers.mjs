// scripts/fetch-movers.mjs
// Run:   npm run history:movers
//
// Downloads real DAILY (8 years) and 5-MINUTE (90 days) candles for the big
// Nifty / Bank Nifty stocks plus both indexes, using Angel One on YOUR computer.
// Tokens are looked up in Angel One's own scrip master, nothing is guessed.
// Saves to data/movers/daily and data/movers/5m (kept apart so the other backtests are not changed).

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { getAngelSession } from "../lib/angelAuth.js";

const API_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData";
const MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = 700;
const ymd = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

// Large, heavily traded Nifty 50 / Bank Nifty names (a starting list; the
// analysis later works out from price data which of them really move the index).
const SYMBOLS = [
  "HDFCBANK", "ICICIBANK", "AXISBANK", "KOTAKBANK", "SBIN", "INDUSINDBK", "BANKBARODA", "PNB", "FEDERALBNK", "AUBANK", "IDFCFIRSTB", "BANDHANBNK",
  "RELIANCE", "INFY", "TCS", "ITC", "LT", "BHARTIARTL", "HINDUNILVR", "BAJFINANCE", "BAJAJFINSV", "M&M", "MARUTI", "SUNPHARMA", "NTPC", "POWERGRID",
  "TATAMOTORS", "TITAN", "ASIANPAINT", "ULTRACEMCO", "HCLTECH", "WIPRO", "TECHM", "ONGC", "COALINDIA", "TATASTEEL", "JSWSTEEL", "HINDALCO", "ADANIENT", "ADANIPORTS", "NESTLEIND", "DRREDDY", "CIPLA",
];

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => [a.slice(2), true]));

console.log("Downloading Angel One scrip master ...");
const master = (await axios.get(MASTER_URL, { timeout: 60000 })).data;
const eq = new Map();
for (const m of master) if (m.exch_seg === "NSE" && m.symbol?.endsWith("-EQ")) eq.set(m.symbol.slice(0, -3), m);
const idxFind = (names) => master.find((m) => m.exch_seg === "NSE" && m.instrumenttype === "AMXIDX" && names.includes(String(m.name).toUpperCase().replace(/\s+/g, "")));
const niftyIdx = idxFind(["NIFTY", "NIFTY50"]);
const bankIdx = idxFind(["BANKNIFTY", "NIFTYBANK"]);
console.log(`Index tokens from master: Nifty 50 = ${niftyIdx?.token}, Bank Nifty = ${bankIdx?.token} (${bankIdx?.name})`);

const jobs = [];
if (niftyIdx) jobs.push({ symbol: "NIFTY 50", token: niftyIdx.token, tag: "NIFTY_50" });
if (bankIdx) jobs.push({ symbol: "BANK NIFTY", token: bankIdx.token, tag: "BANK_NIFTY" });
const missing = [];
for (const s of SYMBOLS) {
  const m = eq.get(s);
  if (m) jobs.push({ symbol: s, token: m.token, tag: s.replace(/[^A-Z0-9]/g, "_") });
  else missing.push(s);
}
if (missing.length) console.log("Not found in scrip master (skipped): " + missing.join(", "));

function chunks(days, chunkDays, withTime) {
  const out = [];
  const day = 86400000;
  let end = Date.now();
  const start = end - days * day;
  while (end > start) {
    const from = Math.max(start, end - chunkDays * day);
    out.push({ from: `${ymd(from)} 09:15`, to: `${ymd(end)} 15:30` });
    end = from - day;
  }
  return out.reverse();
}

async function fetchChunk(session, token, interval, ch) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await axios.post(
        API_URL,
        { exchange: "NSE", symboltoken: String(token), interval, fromdate: ch.from, todate: ch.to },
        {
          headers: {
            "Content-Type": "application/json", Accept: "application/json",
            Authorization: `Bearer ${session.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": session.apiKey,
          },
          timeout: 20000,
        },
      );
      if (res.data?.status && Array.isArray(res.data.data)) return res.data.data;
      const msg = res.data?.message || "no data";
      if (/rate|access|exceed/i.test(msg)) throw new Error(msg);
      return [];
    } catch (err) {
      if (attempt === 4) throw err;
      await sleep(DELAY * 2 ** attempt);
    }
  }
  return [];
}

let session;
try {
  session = await getAngelSession();
} catch (err) {
  console.error("\nAngel One login failed: " + (err.response?.data?.message || err.message));
  process.exit(1);
}
await fs.mkdir("data/movers/daily", { recursive: true });
await fs.mkdir("data/movers/5m", { recursive: true });

for (let k = 0; k < jobs.length; k++) {
  const job = jobs[k];
  try {
    // daily, 8 years
    const dRows = [];
    for (const ch of chunks(8 * 365, 365)) { dRows.push(...(await fetchChunk(session, job.token, "ONE_DAY", ch))); await sleep(DELAY); }
    const byDate = new Map();
    for (const r of dRows) {
      const c = { date: String(r[0]).slice(0, 10), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] || 0 };
      if (c.low > 0 && c.high >= c.low && Number.isFinite(c.close)) byDate.set(c.date, c);
    }
    const daily = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (daily.length) {
      await fs.writeFile(`data/movers/daily/${job.tag}_1d.json`, JSON.stringify({ meta: { symbol: job.symbol, token: job.token, source: "ANGEL_ONE_HISTORICAL", fetchedAt: new Date().toISOString(), firstDate: daily[0].date, lastDate: daily[daily.length - 1].date, candleCount: daily.length }, candles: daily }));
    }
    // 5 minute, 90 days
    const mRows = [];
    for (const ch of chunks(90, 30)) { mRows.push(...(await fetchChunk(session, job.token, "FIVE_MINUTE", ch))); await sleep(DELAY); }
    const byTime = new Map();
    for (const r of mRows) {
      const ts = String(r[0]);
      const c = { time: Math.floor(new Date(ts).getTime() / 1000), date: ts.slice(0, 10), clock: ts.slice(11, 16), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] || 0 };
      if (c.clock >= "09:15" && c.clock < "15:30" && c.low > 0 && c.high >= c.low) byTime.set(c.time, c);
    }
    const intraday = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (intraday.length) {
      await fs.writeFile(`data/movers/5m/${job.tag}_5m.json`, JSON.stringify({ meta: { symbol: job.symbol, token: job.token, timeframeMinutes: 5, source: "ANGEL_ONE_HISTORICAL", fetchedAt: new Date().toISOString(), firstDate: intraday[0].date, lastDate: intraday[intraday.length - 1].date, candleCount: intraday.length, warnings: [] }, candles: intraday }));
    }
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: ${daily.length} daily, ${intraday.length} five-minute candles`);
  } catch (err) {
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: FAILED - ${err.response?.data?.message || err.message}`);
  }
}
console.log("\nDone. Tell Claude 'movers done' to run the analysis.");
