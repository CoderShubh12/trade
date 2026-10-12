// lib/utils.js
import { isMarketOpenIST } from "./sessionUtils";

export function fmt(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return "0.00";
  return Number(num).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Real risk:reward text, calculated from the actual levels (never hardcoded).
// Example: entry 100, stop 98.8, target 102 -> "1:1.7"
export function formatRiskReward(entry, stopLoss, target) {
  const risk = Math.abs(Number(entry) - Number(stopLoss));
  const reward = Math.abs(Number(target) - Number(entry));
  if (!risk || !isFinite(risk) || !isFinite(reward)) return "—";
  return `1:${(reward / risk).toFixed(1)}`;
}

// Indian Standard Time (IST) market hours check.
// Mon-Fri, 09:15 AM to 03:30 PM IST. Uses IST explicitly, so it is correct
// even when the computer's timezone is not India. (No holiday calendar.)
export function isMarketOpen() {
  return isMarketOpenIST();
}

// Web Audio API: Zero-latency institutional synthesizer alert
export function playAlertTone(type = "BUY") {
  if (typeof window === "undefined") return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // 1. BUY: 2-tone upward chime (587.33Hz -> 880Hz)
    // 2. SELL: 2-tone downward warning (784Hz -> 440Hz)
    // 3. EXIT_NOW / SL: 3-tone siren (880Hz -> 659Hz -> 440Hz)
    let freqs = [587.33, 880];
    let oscType = "sine";

    if (type === "SELL") {
      freqs = [784, 440];
    } else if (type === "EXIT_NOW" || type === "SL_HIT") {
      freqs = [880, 659.25, 440];
      oscType = "sawtooth";
    }

    const startTime = ctx.currentTime;

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = oscType;
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.12);

      gain.gain.setValueAtTime(0.18, startTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        startTime + idx * 0.12 + 0.22,
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime + idx * 0.12);
      osc.stop(startTime + idx * 0.12 + 0.25);
    });
  } catch (err) {
    // Autoplay policy fallback
  }
}
