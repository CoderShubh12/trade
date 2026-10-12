// app/api/journal/route.js
// Paper-trade journal: every LIVE call and its exit, kept across days in data/paper-journal.json.
// Replay/practice trades are refused on purpose, so the record contains only real market data.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
const FILE = path.join(process.cwd(), "data", "paper-journal.json");
const MAX = 5000;

async function read() {
  try { const p = JSON.parse(await fs.readFile(FILE, "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}
async function write(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, FILE);
}
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v, m) => String(v ?? "").slice(0, m);

function clean(b) {
  if (!b || b.isReplay) return null;
  const id = s(b.id, 60), symbol = s(b.symbol, 30).toUpperCase();
  if (!id || !symbol || (b.side !== "BUY" && b.side !== "SELL") || !(n(b.entry) > 0)) return null;
  return {
    id, symbol, side: b.side, dateStr: s(b.dateStr, 12), entryClock: s(b.entryClock, 8),
    entry: n(b.entry), stopLoss: n(b.stopLoss), initialSl: n(b.initialSl), target1: n(b.target1), target2: n(b.target2),
    exitPrice: b.exitPrice == null ? null : n(b.exitPrice), exitClock: s(b.exitClock, 8), reason: s(b.reason, 40), r: n(b.r),
  };
}

export async function GET(request) {
  const list = await read();
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const cols = ["dateStr", "entryClock", "symbol", "side", "entry", "stopLoss", "target1", "target2", "exitPrice", "exitClock", "reason", "r"];
    const csv = [cols.join(","), ...list.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=paper-journal.csv" } });
  }
  return NextResponse.json({ success: true, items: list });
}

export async function POST(request) {
  let body; try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Bad JSON" }, { status: 400 }); }
  const item = clean(body);
  if (!item) return NextResponse.json({ success: false, error: "Rejected (replay or invalid)" }, { status: 400 });
  const list = await read();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
  await write(list.slice(-MAX));
  return NextResponse.json({ success: true });
}
