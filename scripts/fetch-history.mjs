// scripts/fetch-history.mjs
// Run:   npm run history
//        npm run history -- --days 120 --limit 20
//        npm run history -- --symbols SBIN,ONGC,TATASTEEL
//
// Downloads real intraday candles from Angel One SmartAPI (it must run on YOUR
// computer, where Angel One is reachable) and saves them to data/history/.
// Safe to run any time, also when the market is closed.

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { getAngelSession } from "../lib/angelAuth.js";
import { STOCK_POOL } from "../lib/stockPool.js";
import { buildChunks, toCandle, validate } from "./history-tools.mjs";

const INTERVALS = { 1: "ONE_MINUTE", 3: "THREE_MINUTE", 5: "FIVE_MINUTE", 15: "FIFTEEN_MINUTE" };
const CHUNK_DAYS = 30; // small chunks stay under every Angel One limit
const API_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData";

function readArgs() {
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--")) args[raw[i].slice(2)] = raw[i + 1]?.startsWith("--") || raw[i + 1] === undefined ? true : raw[++i];
  }
  return args;
}
const args = readArgs();
const days = Number(args.days ?? 90);
const tf = Number(args.tf ?? 5);
const limit = Number(args.limit ?? 15);
const delayMs = Number(args.delay ?? 700); // Angel One limits requests per second
const outDir = path.resolve(args.out ?? "data/history");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!INTERVALS[tf]) {
  console.error("--tf must be one of 1, 3, 5, 15");
  process.exit(1);
}

// Which stocks?
const pool = STOCK_POOL.filter((s) => s.baseBand !== "INDEX");
const wanted = args.symbols
  ? String(args.symbols).split(",").map((s) => s.trim().toUpperCase())
  : null;
const stocks = wanted ? pool.filter((s) => wanted.includes(s.symbol)) : pool.slice(0, limit);
if (stocks.length === 0) {
  console.error("No matching symbols in lib/stockPool.js");
  process.exit(1);
}

async function fetchChunk(session, token, chunk) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await axios.post(
        API_URL,
        { exchange: "NSE", symboltoken: String(token), interval: INTERVALS[tf], fromdate: chunk.from, todate: chunk.to },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${session.jwtToken}`,
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "fe80::1",
            "X-PrivateKey": session.apiKey,
          },
          timeout: 15000,
        },
      );
      if (res.data?.status && Array.isArray(res.data.data)) return res.data.data;
      const msg = res.data?.message || "no data";
      if (/rate|access|exceed/i.test(msg)) throw new Error(msg); // retry below
      return []; // e.g. a chunk made only of holidays
    } catch (err) {
      const wait = delayMs * 2 ** attempt;
      if (attempt === 4) throw err;
      console.log(`    retry ${attempt} in ${wait} ms (${err.response?.data?.message || err.message})`);
      await sleep(wait);
    }
  }
  return [];
}

async function downloadSymbol(session, symbol, tokens) {
  let all = [];
  let usedToken = null;
  for (const token of tokens) {
    // for the index we try the main token first, then the older one
    const collected = [];
    for (const chunk of buildChunks(days, CHUNK_DAYS)) {
      const rows = await fetchChunk(session, token, chunk);
      rows.forEach((r) => collected.push(toCandle(r)));
      await sleep(delayMs);
    }
    if (collected.length > 0) {
      all = collected;
      usedToken = token;
      break;
    }
  }
  const { candles, warnings, dayCount } = validate(all, tf);
  return { candles, warnings, dayCount, usedToken };
}

// ---- main ------------------------------------------------------------------
console.log(`Downloading ${days} days of ${tf}-minute candles for ${stocks.length} stocks + Nifty 50 ...`);
let session;
try {
  session = await getAngelSession();
} catch (err) {
  console.error("\nAngel One login failed: " + (err.response?.data?.message || err.message));
  console.error("Check ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PIN and ANGEL_TOTP_SECRET in .env.local");
  process.exit(1);
}
await fs.mkdir(outDir, { recursive: true });

const jobs = [{ symbol: "NIFTY 50", tokens: ["99926000", "26000"], file: `NIFTY_50_${tf}m.json` }, ...stocks.map((s) => ({ symbol: s.symbol, tokens: [s.token], file: `${s.symbol}_${tf}m.json` }))];

let ok = 0;
for (let k = 0; k < jobs.length; k++) {
  const job = jobs[k];
  try {
    const { candles, warnings, dayCount, usedToken } = await downloadSymbol(session, job.symbol, job.tokens);
    if (candles.length === 0) {
      console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: NO DATA (check token / Angel One login)`);
      continue;
    }
    const meta = {
      symbol: job.symbol,
      token: usedToken,
      timeframeMinutes: tf,
      source: "ANGEL_ONE_HISTORICAL",
      fetchedAt: new Date().toISOString(),
      firstDate: candles[0].date,
      lastDate: candles[candles.length - 1].date,
      sessions: dayCount,
      candleCount: candles.length,
      warnings,
    };
    await fs.writeFile(path.join(outDir, job.file), JSON.stringify({ meta, candles }));
    ok++;
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: ${candles.length} candles, ${dayCount} days (${meta.firstDate} to ${meta.lastDate})${warnings.length ? "  ! " + warnings.join(" | ") : ""}`);
  } catch (err) {
    console.log(`[${k + 1}/${jobs.length}] ${job.symbol}: FAILED - ${err.response?.data?.message || err.message}`);
  }
}
console.log(`\nSaved ${ok}/${jobs.length} files to ${outDir}`);
console.log("Next:  npm run backtest");
