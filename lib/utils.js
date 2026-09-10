// Utility functions for formatting and market sessions

export function fmt(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return "0.00";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Indian Standard Time (IST) Market Hours Check
// Live Intraday Market: Mon-Fri, 09:15 AM to 03:30 PM IST
export function isMarketOpen() {
  const now = new Date();

  // Convert current system time to Asia/Kolkata timezone
  const istStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istStr);

  const day = istDate.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) {
    return false; // Weekend
  }

  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60 + 15; // 09:15 AM IST (555 minutes)
  const marketClose = 15 * 60 + 30; // 03:30 PM IST (930 minutes)

  return totalMinutes >= marketOpen && totalMinutes <= marketClose;
}
// Web Audio API: Zero-latency institutional chime alert
export function playAlertTone(type = "BUY") {
  if (typeof window === "undefined") return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();

    // BUY के लिए 2-टोन हाई पिच (Upward Chime), SELL के लिए 2-टोन लो पिच (Downward Warning)
    const freqs = type === "BUY" ? [587.33, 880] : [784, 440];
    const startTime = ctx.currentTime;

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.12);

      gain.gain.setValueAtTime(0.15, startTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + idx * 0.12 + 0.25,
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.12);
      osc.stop(startTime + idx * 0.12 + 0.28);
    });
  } catch (err) {
    // Silent fail if browser autoplay policy blocks
  }
}
