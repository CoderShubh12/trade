// app/api/watchlist/route.js
// Server-side watchlist. Saved in data/watchlist.json inside the project,
// so it survives browser changes. Single-user tool: one shared list.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "watchlist.json");
const MAX_ITEMS = 100;

async function readList() {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // file not created yet
  }
}

async function writeList(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await fs.rename(tmp, FILE); // swap in one step so a crash cannot half-write
}

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

// Only accept the fields we expect, with sane limits.
function clean(body) {
  const symbol = String(body?.symbol || "").trim().toUpperCase().slice(0, 30);
  const token = String(body?.token || "").trim().slice(0, 20);
  if (!symbol || !/^[A-Z0-9&\-. ]+$/.test(symbol)) return null;
  if (!/^\d+$/.test(token)) return null;
  const side = body?.side === "BUY" || body?.side === "SELL" ? body.side : null;
  return {
    symbol,
    token,
    exchangeSegment: Number(body?.exchangeSegment) || 1,
    source: side ? "CALL" : "MANUAL", // came from a tool call or from the user
    side,
    entry: num(body?.entry),
    stopLoss: num(body?.stopLoss),
    target1: num(body?.target1),
    target2: num(body?.target2),
    score: Number.isFinite(Number(body?.score)) ? Math.round(Number(body.score)) : null,
    note: String(body?.note || "").slice(0, 200),
    addedAt: new Date().toISOString(),
  };
}

export async function GET() {
  return NextResponse.json({ success: true, items: await readList() });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Bad JSON" }, { status: 400 });
  }
  const item = clean(body);
  if (!item) {
    return NextResponse.json({ success: false, error: "Invalid symbol/token" }, { status: 400 });
  }

  const list = await readList();
  const idx = list.findIndex((x) => x.token === item.token);
  if (idx >= 0) {
    // Already there: a new tool call refreshes the levels, a manual add changes nothing.
    if (item.source === "CALL") list[idx] = { ...list[idx], ...item };
  } else {
    if (list.length >= MAX_ITEMS) {
      return NextResponse.json({ success: false, error: "Watchlist full (100)" }, { status: 400 });
    }
    list.unshift(item);
  }
  await writeList(list);
  return NextResponse.json({ success: true, items: list });
}

export async function DELETE(request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^\d+$/.test(token)) {
    return NextResponse.json({ success: false, error: "Invalid token" }, { status: 400 });
  }
  const list = (await readList()).filter((x) => x.token !== token);
  await writeList(list);
  return NextResponse.json({ success: true, items: list });
}
