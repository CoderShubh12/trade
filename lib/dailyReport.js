// lib/dailyReport.js (pure) - one-day summary of the paper journal and the picker log. Read-only, never trades.
const sum = (a) => a.reduce((x, y) => x + y, 0);
export function buildDailyReport(journal, pickerLog, day) {
  const rows = (Array.isArray(journal) ? journal : []).filter((r) => r.dateStr === day);
  const closed = rows.filter((r) => r.exitPrice != null && Number.isFinite(Number(r.r)));
  const open = rows.filter((r) => r.exitPrice == null);
  const rs = closed.map((r) => Number(r.r));
  const win = rs.filter((x) => x > 0).length;
  const by = (key) => {
    const m = {};
    for (const r of closed) { const k = r[key] || "page"; (m[k] = m[k] || []).push(Number(r.r)); }
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { n: v.length, sumR: +sum(v).toFixed(2) }]));
  };
  const ev = pickerLog && pickerLog.day === day && Array.isArray(pickerLog.evals) ? pickerLog.evals : [];
  const pk = (f) => (ev.length ? +(sum(ev.map((e) => Number(e[f]) || 0)) / ev.length).toFixed(3) : null);
  return {
    day, calls: rows.length, open: open.length, closed: closed.length, wins: win,
    winRate: closed.length ? +(win / closed.length).toFixed(2) : null, sumR: +sum(rs).toFixed(2),
    bySource: by("source"), bySide: by("side"), bySymbol: by("symbol"),
    picker: { evals: ev.length, meanPicksFwdPct: pk("picksFwd"), meanAllFwdPct: pk("allFwd"), meanNetPct: pk("picksFwd") == null ? null : +(pk("picksFwd") - 0.1).toFixed(3) },
    note: "Paper only. A single day is noise, not proof of an edge.",
  };
}
