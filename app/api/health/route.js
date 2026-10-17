// app/api/health/route.js
// GET /api/health -> status of the safety bots (backup, journal integrity). Read-only apart from taking a backup snapshot.
import { NextResponse } from "next/server";
import { backupNow, backupStatus, integrityReport, getHealth } from "../../../lib/safetyBots.js";

export const dynamic = "force-dynamic";

export async function GET() {
  await backupNow("health-check"); // makes sure at least one snapshot exists after a restart
  const [backup, integrity, health] = await Promise.all([backupStatus(), integrityReport(), getHealth({ force: true })]);
  return NextResponse.json({
    success: true,
    time: new Date().toISOString(),
    health: { level: health.level, reasons: health.reasons, marketOpen: health.marketOpen, engineError: health.engineError },
    backup,
    integrity: { ok: integrity.ok, rows: integrity.rows, counts: integrity.counts, issues: integrity.issues.slice(0, 50) },
  });
}
