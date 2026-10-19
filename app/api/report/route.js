// app/api/report/route.js - GET /api/report?day=YYYY-MM-DD (default: today IST). Read-only daily summary.
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { readJournal } from "../../../lib/journalStore.js";
import { buildDailyReport } from "../../../lib/dailyReport.js";

export const dynamic = "force-dynamic";
const istDay = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("day");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q || "") ? q : istDay();
  let pk = null;
  try { pk = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "picker-log.json"), "utf8")); } catch {}
  const rep = buildDailyReport(await readJournal(), pk, day);
  return NextResponse.json({ success: true, report: rep });
}
