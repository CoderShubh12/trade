// app/api/backfill/route.js - OWNER only. One-time seed of TODAY's earlier 5m bars (09:15 -> now) for the watchlist from Angel's
// candle API, so the live bars have history. Stops at the first refusal (Angel rate limit) so it never hammers the API.
// Live bars already recorded are kept; only missing buckets of today are added. POST /api/backfill
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { GET as candlesGET } from "../market-data/route.js";
import { seedBars } from "@/lib/tickCandles";
import { requestUser, ownerName } from "@/lib/userScope";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const u = requestUser(request);
  if (u && u !== ownerName()) return NextResponse.json({ success: false, error: "Owner only" }, { status: 403 });
  let list = [];
  try { list = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "watchlist.json"), "utf8")); } catch {}
  const only = (new URL(request.url).searchParams.get("tokens") || "").split(",").filter((x) => /^\d+$/.test(x)); // retry just some tokens
  const toks = only.length ? only : [...new Set([...(Array.isArray(list) ? list : []).slice(0, 6).map((x) => String(x.token)), "99926000"])];
  const out = [];
  for (const token of toks) {
    const res = await candlesGET(new Request(`http://local/api/market-data?token=${token}&tf=5&source=angel`));
    const j = await res.json();
    if (!j.success || j.tickBuilt || !Array.isArray(j.data)) { out.push({ token, ok: false, error: (j.error || j.warning || "no data").slice(0, 100) }); break; } // stop at the first refusal
    out.push({ token, ok: true, added: seedBars(token, j.data), got: j.data.length });
  }
  return NextResponse.json({ success: out.some((x) => x.ok), results: out, note: "Seeded from Angel candles; stops at the first refusal." });
}
