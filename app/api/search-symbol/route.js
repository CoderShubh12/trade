// app/api/search-symbol/route.js
// Symbol search over Angel One's instrument master (NSE equities + main indices).
// The master is large, so it is cached in memory AND on disk (data/scrip-master.json, 24h),
// downloaded once at a time, and an old copy is used if the download fails.
import { NextResponse } from "next/server";
import axios from "axios";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "scrip-master.json");
const TTL_MS = 24 * 60 * 60 * 1000;
const URL_MASTER = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

const g = globalThis;
g.__scripMaster = g.__scripMaster || { list: null, at: 0, loading: null };

async function readDisk() {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (Array.isArray(raw.list) && raw.list.length > 100) return raw;
  } catch {}
  return null;
}

async function download() {
  const res = await axios.get(URL_MASTER, { timeout: 40000 });
  if (!Array.isArray(res.data)) throw new Error("Unexpected scrip master format");
  const list = res.data
    .filter((i) => i.exch_seg === "NSE" && (i.symbol?.endsWith("-EQ") || i.instrumenttype === "AMXIDX"))
    .map((i) => ({
      symbol: i.name || i.symbol.replace("-EQ", ""),
      fullSymbol: i.symbol,
      name: i.symbol,
      token: i.token,
      exchangeSegment: 1,
    }));
  if (list.length < 100) throw new Error("Scrip master looks empty");
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE + ".tmp", JSON.stringify({ at: Date.now(), list }), "utf8");
  await fs.rename(FILE + ".tmp", FILE);
  return { list, at: Date.now() };
}

async function getMaster() {
  const m = g.__scripMaster;
  if (m.list && Date.now() - m.at < TTL_MS) return m.list;
  if (!m.loading) {
    m.loading = (async () => {
      const disk = await readDisk();
      if (disk && Date.now() - disk.at < TTL_MS) { m.list = disk.list; m.at = disk.at; return; }
      try {
        const fresh = await download();
        m.list = fresh.list; m.at = fresh.at;
      } catch (e) {
        console.error("Scrip master download failed:", e.message);
        if (disk) { m.list = disk.list; m.at = Date.now() - TTL_MS + 10 * 60 * 1000; } // old copy, retry in 10 min
      }
    })().finally(() => { m.loading = null; });
  }
  await m.loading;
  return m.list || [];
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim().toUpperCase();
  if (!q || q.length < 2) return NextResponse.json({ success: true, results: [] });

  const master = await getMaster();
  const rank = (i) => {
    const s = i.symbol.toUpperCase(), f = i.fullSymbol.toUpperCase();
    if (s === q || f === `${q}-EQ`) return 0;
    if (s.startsWith(q)) return 1;
    if (s.includes(q)) return 2;
    if (f.includes(q)) return 3;
    return 9;
  };
  const results = master
    .map((i) => [rank(i), i])
    .filter(([r]) => r < 9)
    .sort((a, b) => a[0] - b[0] || a[1].symbol.length - b[1].symbol.length)
    .slice(0, 15)
    .map(([, i]) => i);

  if (!master.length) {
    return NextResponse.json({ success: false, error: "Symbol list unavailable, try again in a minute", results: [] });
  }
  return NextResponse.json({ success: true, results });
}
