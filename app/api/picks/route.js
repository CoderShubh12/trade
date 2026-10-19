// app/api/picks/route.js
// Research-only log of the intraday "picker" (top relative-move stocks every 15 min) so the dashboard can show it.
// GET  -> { day, snaps:[{clock,picks[]}], evals:[{clock,picksFwd,allFwd,hit,n}] }  (today only)
// POST -> { snaps, evals } replaces today's log. Needs the normal login cookie (middleware). NOT a trade signal; nothing here places or changes a trade.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
const FILE = path.join(process.cwd(), "data", "picker-log.json");
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

async function read() {
  try { const j = JSON.parse(await fs.readFile(FILE, "utf8")); return j && j.day === today() ? j : { day: today(), snaps: [], evals: [] }; }
  catch { return { day: today(), snaps: [], evals: [] }; }
}

export async function GET() {
  return NextResponse.json({ success: true, ...(await read()) });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: "Bad JSON" }, { status: 400 }); }
  const clean = (arr, n) => (Array.isArray(arr) ? arr.slice(-n) : []);
  const snaps = clean(body.snaps, 40).map((s) => ({
    clock: String(s.clock || "").slice(0, 5), base: !!s.base,
    picks: clean(s.picks, 10).map((p) => ({ n: String(p.n).slice(0, 20), px: Number(p.px) || 0, dir: p.dir > 0 ? 1 : -1, rs: Number(p.rs) || 0 })),
  }));
  const evals = clean(body.evals, 40).map((e) => ({ clock: String(e.clock || "").slice(0, 5), picksFwd: Number(e.picksFwd), allFwd: Number(e.allFwd), hit: Number(e.hit) || 0, n: Number(e.picksN ?? e.n) || 0 }));
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify({ day: today(), snaps, evals }, null, 1));
  await fs.rename(tmp, FILE);
  return NextResponse.json({ success: true, snaps: snaps.length, evals: evals.length });
}
