// lib/signalMemory.js
// Stops the app from giving a call on every candle.
//
// Rules (change the numbers in SIGNAL_RULES):
//  1. ONE CALL PER SETUP. After a call, the stock must "cool off" - its score
//     has to fall below `reArmBelowScore` (or flip to the other side) before
//     a new call is allowed. A score that simply stays high gives NO new call.
//  2. COOLDOWN AFTER EXIT. No new call for `cooldownAfterExitMin` minutes
//     after a trade closes (target, stop-loss, time-out or square-off).
//  3. DAILY CAP. At most `maxEntriesPerStockPerDay` calls per stock per day.
//
// Everything here is plain data in / data out, so it is easy to test.

export const SIGNAL_RULES = {
  reArmBelowScore: 50,
  cooldownAfterExitMin: 30,
  maxEntriesPerStockPerDay: 3,
};

export function newSignalMemory(dateStr) {
  return { dateStr, armed: true, lastSide: null, lastExitMs: null, entries: 0 };
}

// Call on every closed candle with the latest score.
export function observeScore(memory, score, dateStr) {
  let mem = memory;
  if (!mem || mem.dateStr !== dateStr) mem = newSignalMemory(dateStr); // new day
  if (mem.armed) return mem;

  const side = score >= 0 ? "BUY" : "SELL";
  const cooledOff = Math.abs(score) < SIGNAL_RULES.reArmBelowScore;
  const flipped = mem.lastSide && Math.abs(score) >= 65 && side !== mem.lastSide;
  return cooledOff || flipped ? { ...mem, armed: true } : mem;
}

export function checkSignalAllowed(memory, nowMs) {
  if (!memory.armed) {
    return {
      allowed: false,
      reason: `Call already given - waiting for score to cool below ${SIGNAL_RULES.reArmBelowScore}`,
    };
  }
  if (memory.entries >= SIGNAL_RULES.maxEntriesPerStockPerDay) {
    return {
      allowed: false,
      reason: `Daily limit reached (${SIGNAL_RULES.maxEntriesPerStockPerDay} calls on this stock)`,
    };
  }
  if (memory.lastExitMs !== null) {
    const waitMs = SIGNAL_RULES.cooldownAfterExitMin * 60 * 1000;
    const leftMs = memory.lastExitMs + waitMs - nowMs;
    if (leftMs > 0) {
      return {
        allowed: false,
        reason: `Cooling down after last trade (${Math.ceil(leftMs / 60000)} min left)`,
      };
    }
  }
  return { allowed: true, reason: "OK" };
}

export function recordEntry(memory, side) {
  return { ...memory, armed: false, lastSide: side, entries: memory.entries + 1 };
}

export function recordExit(memory, nowMs) {
  return { ...memory, lastExitMs: nowMs };
}
