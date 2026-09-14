// lib/advancedGuards.js

// 1. Liquidity & Gap-Day Filter
export function checkMarketLiquidityAndGaps(candles, openPrice, prevClose) {
  if (!candles || candles.length < 5) return { passed: true };

  // गैप-डे चेक: अगर ओपनिंग प्राइस पिछले क्लोज से 2% से ज्यादा गैप पर है
  const gapPercent = Math.abs((openPrice - prevClose) / prevClose) * 100;
  if (gapPercent > 2.0) {
    return { passed: false, reason: "GAP_DAY_VOLATILITY_BLOCK (Gap > 2%)" };
  }

  // लिक्विडिटी फिल्टर: पिछले 5 कैंडल्स का औसत वॉल्यूम चेक करें
  const recentVolume =
    candles.slice(-5).reduce((acc, c) => acc + (c.volume || 0), 0) / 5;
  if (recentVolume < 5000) {
    return { passed: false, reason: "LOW_LIQUIDITY_WARNING (Volume too low)" };
  }

  return { passed: true, reason: "LIQUIDITY_CHECK_PASSED" };
}

// 2. Signal Cooldown Shield (बार-बार फेक सिग्नल रोकने के लिए)
let lastSignalTimestamp = 0;
export function checkSignalCooldown(cooldownMinutes = 10) {
  const now = Date.now();
  const diffMinutes = (now - lastSignalTimestamp) / (1000 * 60);

  if (diffMinutes < cooldownMinutes) {
    return {
      allowed: false,
      remainingMins: Math.ceil(cooldownMinutes - diffMinutes),
    };
  }

  lastSignalTimestamp = now;
  return { allowed: true };
}

// 3. Emergency Kill Switch / Read-Only Mode State
let isKillSwitchActive = false;
export function toggleKillSwitch(status) {
  isKillSwitchActive = status;
  return isKillSwitchActive;
}

export function checkKillSwitch() {
  return isKillSwitchActive;
}
