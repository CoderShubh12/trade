// scripts/record-depth.mjs
// Records REAL 5-level order-book snapshots (Angel One REST quote, mode FULL, ~1 per second)
// for liquid NSE stocks during market hours into data/depth/YYYY-MM-DD.jsonl.
// Run on YOUR computer:   npm run record        (test outside hours: npm run record -- --always)
// RECORDS ONLY. Never places orders, never gives signals. Credentials stay on this machine.

import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { getAngelSession } from "../lib/angelAuth.js";
import { toRow, plausible } from "./depth-tools.mjs";

const DEFAULT = "HDFCBANK,ICICIBANK,RELIANCE,SBIN,AXISBANK,INFY,TCS,KOTAKBANK,ITC,LT";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const symbols = String(arg("symbols", DEFAULT)).split(",").map((s) => s.trim().toUpperCase());
const OUT = path.resolve(arg("out", "data/depth"));
const GAP_MS = Number(arg("gap", 1100)); // Angel allows about 1 quote request per second
const ALWAYS = process.argv.includes("--always");
fs.mkdirSync(OUT, { recursive: true });

const nameOf = {}; // token -> symbol
for (const s of symbols) {
  try {
    const m = JSON.parse(fs.readFileSync(`data/movers/5m/${s}_5m.json`, "utf8")).meta;
    nameOf[String(m.token)] = s;
  } catch { console.error(`No token for ${s} (run npm run history:movers first) - skipped`); }
}
const tokens = Object.keys(nameOf);
if (!tokens.length) { console.error("No symbols to record"); process.exit(1); }

const ist = () => { const d = new Date(Date.now() + 5.5 * 3600e3); return { day: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() }; };
const inHours = () => { const t = ist(); return t.dow >= 1 && t.dow <= 5 && t.mins >= 9 * 60 + 14 && t.mins <= 15 * 60 + 31; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stream = null, streamDay = null, rows = 0, bad = 0, errs = 0, polls = 0, rawSaved = 0, lastLog = 0, lastSnap = {};
function write(row) {
  const day = ist().day;
  if (day !== streamDay) { stream?.end(); stream = fs.createWriteStream(path.join(OUT, `${day}.jsonl`), { flags: "a" }); streamDay = day; }
  stream.write(JSON.stringify(row) + "\n");
}

async function poll(session) {
  const res = await axios.post(
    "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",
    { mode: "FULL", exchangeTokens: { NSE: tokens } },
    {
      headers: {
        "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session.jwtToken}`,
        "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1",
        "X-MACAddress": "fe80::1", "X-PrivateKey": session.apiKey,
      },
      timeout: 5000,
    },
  );
  const list = res.data?.data?.fetched;
  if (!res.data?.status || !Array.isArray(list)) throw new Error(res.data?.message || "quote failed");
  if (rawSaved < 5) { rawSaved++; fs.appendFileSync(path.join(OUT, "raw-samples.jsonl"), JSON.stringify(list.slice(0, 2)) + "\n"); }
  const now = Date.now();
  for (const q of list) {
    const row = toRow(q, nameOf[String(q.symbolToken)] || q.tradingSymbol, now);
    if (!plausible(row)) { bad++; continue; }
    // store only when something changed (exchange time, price or volume)
    const sig = `${row.e}|${row.l}|${row.v}|${row.b[0]?.join()}|${row.a[0]?.join()}`;
    if (lastSnap[row.k] === sig) continue;
    lastSnap[row.k] = sig;
    write(row); rows++;
  }
}

(async () => {
  console.log("recording", Object.values(nameOf).join(","), ALWAYS ? "(always)" : "(market hours only)");
  while (true) {
    if (!ALWAYS && !inHours()) {
      const t = ist();
      if (t.mins > 15 * 60 + 31 && t.dow >= 1 && t.dow <= 5 && polls > 0) { console.log("session finished"); break; }
      console.log("waiting for market hours (Mon-Fri 09:14-15:31 IST)..."); await sleep(30000); continue;
    }
    const t0 = Date.now();
    try { await poll(await getAngelSession()); polls++; }
    catch (e) { errs++; console.error("poll failed:", e.response?.status || "", e.message); await sleep(2000); }
    if (Date.now() - lastLog > 60000) { lastLog = Date.now(); console.log(new Date().toLocaleTimeString(), `rows ${rows} rejected ${bad} polls ${polls} errors ${errs}`); }
    await sleep(Math.max(0, GAP_MS - (Date.now() - t0)));
  }
  stream?.end(); console.log("done. rows:", rows, "rejected:", bad);
})();
