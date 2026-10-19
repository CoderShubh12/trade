// lib/ownerGuard.js (pure) - single-owner rule: a NEW call from the page is checked against the same exposure limits the server engine uses,
// counting ALL journal rows (page + engine), so the two cannot double up. Closing/updating an existing row is never blocked. Paper only.
import { checkExposure } from "./safetyBots.js";

export function checkNewCall(list, item, rules) {
  if (!item || item.exitPrice != null) return { allowed: true, code: "CLOSE", reason: "update/close" };
  if (!Array.isArray(list)) return { allowed: true, code: "NO_LIST", reason: "no journal" };
  if (list.some((r) => r.id === item.id)) return { allowed: true, code: "UPDATE", reason: "existing row" };
  const day = list.filter((r) => r.dateStr === item.dateStr);
  const open = day.filter((r) => r.exitPrice == null);
  if (open.some((r) => r.symbol === item.symbol)) return { allowed: false, code: "SYMBOL_OPEN", reason: `${item.symbol} already has an open paper trade` };
  const stockResults = day.filter((r) => r.symbol === item.symbol && r.exitPrice != null).map((r) => (Number(r.r) > 0 ? "W" : "L"));
  return checkExposure({ side: item.side, open: open.map((r) => ({ side: r.side })), callsToday: day.length, stockResults, niftyPct: null }, rules);
}
