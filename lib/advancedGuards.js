// lib/advancedGuards.js

export function checkMarketLiquidityAndGaps(candles, openPrice, prevClose) {
  if (!candles || candles.length < 5) return { passed: true };

  if (openPrice && prevClose) {
    const gapPercent = Math.abs((openPrice - prevClose) / prevClose) * 100;
    if (gapPercent > 2.0) {
      return { passed: false, reason: "GAP_DAY_VOLATILITY_BLOCK (Gap > 2%)" };
    }
  }

  const recentVolume =
    candles.slice(-5).reduce((acc, c) => acc + (c.volume || 0), 0) / 5;

  if (recentVolume > 0 && recentVolume < 3000) {
    return { passed: false, reason: "LOW_LIQUIDITY_WARNING (Volume too low)" };
  }

  return { passed: true, reason: "LIQUIDITY_CHECK_PASSED" };
}

// Browser-safe persistent quarantine engine
function getStorageMap(key) {
  if (typeof window === "undefined") return {};
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : {};
  } catch {
    return {};
  }
}

function saveStorageMap(key, map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {}
}

const QUARANTINE_STORAGE_KEY = "terminal_stock_quarantine";
const THROTTLE_STORAGE_KEY = "terminal_stock_throttle";

export function setStockPostLossCooldown(token, cooldownMinutes = 45) {
  const key = String(token);
  const now = Date.now();
  const currentMap = getStorageMap(QUARANTINE_STORAGE_KEY);
  const currentRecord = currentMap[key] || { slHitsToday: 0 };

  const updatedHits = currentRecord.slHitsToday + 1;
  const duration = updatedHits >= 2 ? 360 : cooldownMinutes;
  const unlockTime = now + duration * 60 * 1000;

  currentMap[key] = {
    unlockTime,
    slHitsToday: updatedHits,
    isPermanentDayBan: updatedHits >= 2,
  };

  saveStorageMap(QUARANTINE_STORAGE_KEY, currentMap);
}

export function isStockInCooldown(token) {
  const key = String(token);
  const currentMap = getStorageMap(QUARANTINE_STORAGE_KEY);
  const record = currentMap[key];

  if (!record) return { inCooldown: false };

  const now = Date.now();
  if (now < record.unlockTime) {
    const remainingMins = Math.ceil((record.unlockTime - now) / (60 * 1000));
    return {
      inCooldown: true,
      remainingMins,
      isPermanentDayBan: record.isPermanentDayBan,
      reason: record.isPermanentDayBan
        ? "DAILY_MAX_STRIKE_LOCKOUT (2 SL hits today on this stock)"
        : `POST_LOSS_COOLDOWN_ACTIVE (${remainingMins}m remaining)`,
    };
  }

  delete currentMap[key];
  saveStorageMap(QUARANTINE_STORAGE_KEY, currentMap);
  return { inCooldown: false };
}

export function checkStockSignalThrottle(token, throttleMinutes = 5) {
  const key = String(token);
  const now = Date.now();
  const currentMap = getStorageMap(THROTTLE_STORAGE_KEY);
  const lastTime = currentMap[key] || 0;
  const diffMinutes = (now - lastTime) / (1000 * 60);

  if (diffMinutes < throttleMinutes) {
    return {
      allowed: false,
      remainingMins: Math.ceil(throttleMinutes - diffMinutes),
    };
  }

  return { allowed: true };
}

export function markStockSignalExecuted(token) {
  const key = String(token);
  const currentMap = getStorageMap(THROTTLE_STORAGE_KEY);
  currentMap[key] = Date.now();
  saveStorageMap(THROTTLE_STORAGE_KEY, currentMap);
}

let isKillSwitchActive = false;

export function toggleKillSwitch(status) {
  isKillSwitchActive = status;
  return isKillSwitchActive;
}

export function checkKillSwitch() {
  return isKillSwitchActive;
}
