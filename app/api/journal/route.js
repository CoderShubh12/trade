// app/api/journal/route.js
// Paper-trade journal: every LIVE call and its exit, kept across days in data/paper-journal.json.
// Replay/practice trades are refused on purpose, so the record contains only real market data.
import { NextResponse } from "next/server";
import { readJournal, updateJournal, upsertCall } from "../../../lib/journalStore.js";
import { reconcileOpen } from "../../../lib/journalReconcile.js";
import { checkNewCall } from "../../../lib/ownerGuard.js";
import { requestUser } from "../../../lib/userScope.js";

export const dynamic = "force-dynamic";
const read = (user) => readJournal(user);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const s = (v, m) => String(v ?? "").slice(0, m);

function cleanFeat(f) {
  if (!f || typeof f !== "object") return undefined;
  const o = {};
  for (const k of Object.keys(f).slice(0, 12)) {
    const v = f[k];
    if (typeof v === "number" && Number.isFinite(v)) o[k.slice(0, 20)] = v;
    else if (typeof v === "string") o[k.slice(0, 20)] = v.slice(0, 30);
  }
  return o;
}

function clean(b) {
  if (!b || b.isReplay) return null;
  const id = s(b.id, 60), symbol = s(b.symbol, 30).toUpperCase();
  if (!id || !symbol || (b.side !== "BUY" && b.side !== "SELL") || !(n(b.entry) > 0)) return null;
  return {
    id, symbol, side: b.side, timeframe: s(b.timeframe, 4) || "5", token: /^\d{1,10}$/.test(String(b.token ?? "")) ? String(b.token) : undefined, feat: cleanFeat(b.feat), dateStr: s(b.dateStr, 12), entryClock: s(b.entryClock, 8),
    entry: n(b.entry), stopLoss: n(b.stopLoss), initialSl: n(b.initialSl), target1: n(b.target1), target2: n(b.target2),
    exitPrice: b.exitPrice == null ? null : n(b.exitPrice), exitClock: s(b.exitClock, 8), reason: s(b.reason, 40), r: n(b.r), source: b.source ? s(b.source, 10) : undefined,
  };
}

const lastRecBy = new Map();
async function maybeReconcile(user) {
  if (Date.now() - (lastRecBy.get(user || "") || 0) < 120000) return;
  lastRecBy.set(user || "", Date.now());
  try {
    const found = await reconcileOpen(await read(user));
    if (!found.length) return;
    await updateJournal((fresh) => { // re-read under the lock: never overwrite a newer write
      let changed = false;
      for (const f of found) {
        const i = fresh.findIndex((x) => x.id === f.id && x.exitPrice == null);
        if (i >= 0) { const { id, ...rest } = f; fresh[i] = { ...fresh[i], ...rest }; changed = true; }
      }
      return changed ? fresh : undefined;
    }, user);
  } catch { /* never break the journal because of reconcile */ }
}

export async function GET(request) {
  const user = requestUser(request);
  await maybeReconcile(user);
  const list = await read(user);
  if (new URL(request.url).searchParams.get("format") === "csv") {
    const cols = ["dateStr", "entryClock", "symbol", "timeframe", "side", "entry", "stopLoss", "target1", "target2", "exitPrice", "exitClock", "reason", "r"];
    const csv = [cols.join(","), ...list.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=paper-journal.csv" } });
  }
  return NextResponse.json({ success: true, items: list });
}

export async function POST(request) {
  let body; try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Bad JSON" }, { status: 400 }); }
  const item = clean(body);
  if (!item) return NextResponse.json({ success: false, error: "Rejected (replay or invalid)" }, { status: 400 });
  const user = requestUser(request);
  const guard = checkNewCall(await read(user), item);
  if (!guard.allowed) return NextResponse.json({ success: false, blocked: true, code: guard.code, error: guard.reason }, { status: 409 });
  await upsertCall(item, user);
  return NextResponse.json({ success: true });
}
