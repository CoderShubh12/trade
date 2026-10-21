// lib/ownerGuard.js (pure) - single-owner rule: a NEW call from the page is checked against the same exposure limits the server engine uses,
// counting ALL journal rows (page + engine), so the two cannot double up. Closing/updating an existing row is never blocked. Paper only.
import { checkExposure } from "./safetyBots.js";

export const DAY_LOSS_R = 3; // same limit as the server engine; counts ALL sources

export function checkNewCall(list, item, rules) {
  if (!item) return { allowed: true, code: "NO_ITEM", reason: "nothing to check" };
  if (!Array.isArray(list)) return { allowed: true, code: "NO_LIST", reason: "no journal" };
  if (list.some((r) => r.id === item.id)) return { allowed: true, code: "UPDATE", reason: "existing row" };
  // An exit for a call that was never stored (its entry was blocked or never arrived) must not create a closed row out of nowhere.
  if (item.exitPrice != null) return { allowed: false, code: "ORPHAN_EXIT", reason: "exit for a call that is not in the journal (its entry was blocked or never stored)" };
  const day = list.filter((r) => r.dateStr === item.dateStr);
  const open = day.filter((r) => r.exitPrice == null);
  if (open.some((r) => r.symbol === item.symbol)) return { allowed: false, code: "SYMBOL_OPEN", reason: `${item.symbol} already has an open paper trade` };
  const dayR = day.filter((r) => r.exitPrice != null).reduce((a, r) => a + (Number(r.r) || 0), 0);
  if (dayR <= -DAY_LOSS_R) return { allowed: false, code: "DAY_LOSS", reason: `day loss limit reached (${dayR.toFixed(1)}R, limit -${DAY_LOSS_R}R, all sources)` };
  const stockResults = day.filter((r) => r.symbol === item.symbol && r.exitPrice != null).map((r) => (Number(r.r) > 0 ? "W" : "L"));
  return checkExposure({ side: item.side, open: open.map((r) => ({ side: r.side })), callsToday: day.length, stockResults, niftyPct: null }, rules);
}
