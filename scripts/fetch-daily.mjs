// scripts/fetch-daily.mjs
// Run:   npm run history:daily
//        npm run history:daily -- --years 8 --limit 40
//        npm run history:daily -- --symbols SBIN,ITC
//
// Downloads real DAILY candles from Angel One SmartAPI (run it on YOUR computer,
// where Angel One is reachable) and saves them to data/daily/.

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { getAngelSession } from "../lib/angelAuth.js";
import { STOCK_POOL } from "../lib/stockPool.js";

const API_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData";
const CHUNK_DAYS = 365; // one year per request keeps us far under Angel One's daily-candle limit

function readArgs() {
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--")) args[raw[i].slice(2)] = raw[i + 1]?.startsWith("--") || raw[i + 1] === undefined ? true : raw[++i];
  }
  return args;
}
const args = readArgs();
const years = Number(args.years ?? 8);
const limit = Number(args.limit ?? 60);
const delayMs = Number(args.delay ?? 700);
const outDir = path.resolve(args.out ?? "data/daily");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10); // IST date

const pool = STOCK_POOL.filter((s) => s.baseBand !== "INDEX");
const wanted = args.symbols ? String(args.symbols).split(",").map((s) => s.trim().toUpperCase()) : null;
const stocks = wanted ? pool.filter((s) => wanted.includes(s.symbol)) : pool.slice(0, limit);

function chunks() {
  const out = [];
  const day = 86400000;
  let end = Date.now();
  const start = end - years * 365 * day;
  while (end > start) {
    const from = Math.max(start, end - CHUNK_DAYS * day);
    out.push({ from: `${ymd(from)} 09:15`, to: `${ymd(end)} 15:30` });
    end = from - day;
  }
  return out.reverse();
}

async function fetchChunk(session, token, chunk) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await axios.post(
        API_URL,
        { exchange: "NSE", symboltoken: String(token), interval: "ONE_DAY", fromdate: chunk.from, todate: chunk.to },
        {
          headers: {
            "Content-Type": "application/json", Accept: "application/json",
            Authorization: `Bearer ${session.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1",
            "X-PrivateKey": session.apiKey,
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
      const wait = delayMs * 2 ** attempt;
      console.log(`    retry ${attempt} in ${wait} ms (${err.response?.data?.message || err.message})`);
      await sleep(wait);
    }
  }
  return [];
}

console.log(`Downloading ${years} years of DAILY candles for ${stocks.length} stocks + Nifty 50 ...`);
let session;
try {
  session = await getAngelSession();
} catch (err) {
  console.error("\nAngel One login failed: " + (err.response?.data?.message || err.message));
  process.exit(1);
}
await fs.mkdir(outDir, { recursive: true });

const jobs = [
  { symbol: "NIFTY 50", tokens: ["99926000", "26000"], file: "NIFTY_50_1d.json" },
  ...stocks.map((s) => ({ symbol: s.symbol, tokens: [s.token], file: `${s.symbol}_1d.json` })),
];

let ok = 0;
for (let k = 0; k < jobs.length; k++) {
  const job = jobs[k];
  try {
    let rows = [];
    let usedToken = null;
    for (const token of job.tokens) {
      const got = [];
      for (const ch of chunks()) {
        got.push(...(await fetchChunk(session, token, ch)));
        await sleep(delayMs);
      }
      if (got.length) { rows = got; usedToken = token; break; }
    }
    // clean: one candle per date, sane prices, sorted
    const byDate = new Map();
    for (const r of rows) {
      const c = { date: String(r[0]).slice(0, 10), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] || 0 };
      if (c.low > 0 && c.high >= c.low && Number.isFinite(c.close)) byDate.set(c.date, c);
    }
    const candles = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!candles.length) { console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: NO DATA`); continue; }
    const meta = { symbol: job.symbol, token: usedToken, source: "ANGEL_ONE_HISTORICAL", fetchedAt: new Date().toISOString(), firstDate: candles[0].date, lastDate: candles[candles.length - 1].date, candleCount: candles.length };
    await fs.writeFile(path.join(outDir, job.file), JSON.stringify({ meta, candles }));
    ok++;
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: ${candles.length} days (${meta.firstDate} to ${meta.lastDate})`);
  } catch (err) {
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: FAILED - ${err.response?.data?.message || err.message}`);
  }
}
console.log(`\nSaved ${ok}/${jobs.length} files to ${outDir}`);
console.log("Next:  npm run daily-backtest");
