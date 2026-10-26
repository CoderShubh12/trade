// lib/timeMachine.js - "Time Machine" for NSE intraday: replays the rest of the session 10,000 times by bootstrapping the stock's OWN 5m bars from the
// last ~60 sessions, plus re-runs the same plan on every past session. A SIMULATION, not a prediction. Same seed => same numbers.
// Idea from the (US-only) trader-timemachine skill; this is our own NSE implementation (09:15-15:25 bars, IST).
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const clockIdx = (c) => { const [h, m] = c.split(":").map(Number); return Math.round((h * 60 + m - 555) / 5); }; // 09:15 -> 0 ... 15:25 -> 74
export function timeMachine(bars, plan, { replays = 10000, seed = 19, window = 2 } = {}) {
  const { side, entry, stop, target } = plan, d = side === "BUY" ? 1 : -1, until = plan.until || "15:15";
  if (!(entry > 0) || !(d * (entry - stop) > 0) || !(d * (target - entry) > 0)) throw new Error("Plan does not make sense: BUY needs stop < entry < target (SELL the reverse).");
  const byDay = new Map(); for (const b of bars) { if (!byDay.has(b.date)) byDay.set(b.date, []); byDay.get(b.date).push(b); }
  // index each session by NSE bar slot (09:15 = 0 ... 15:25 = 74) so a missing bar cannot shift the others; need most of the day present
  const days = [...byDay.entries()].filter(([, a]) => a.length >= 65).map(([date, a]) => { const slot = Array(75).fill(null); for (const b of a) { const k = clockIdx(b.clock); if (k >= 0 && k < 75) slot[k] = b; } return { date, a: slot }; });
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const full = days.filter((x) => x.date < today);
  if (full.length < 20) throw new Error(`Only ${full.length} full past sessions found (need at least 20).`);
  const startI = Math.max(0, Math.min(74, clockIdx(plan.entryTime || "10:15"))), endI = Math.min(74, clockIdx(until));
  if (endI <= startI) throw new Error("Entry time must be before the 'until' time.");
  // pool: ratios of each bar to the previous close, by bar index
  const pool = Array.from({ length: 75 }, () => []);
  for (const { a } of full) for (let i = 1; i < 75; i++) { if (!a[i] || !a[i - 1]) continue; const pc = a[i - 1].close; pool[i].push([a[i].open / pc, a[i].high / pc, a[i].low / pc, a[i].close / pc]); }
  const R = rng(seed), risk = Math.abs(entry - stop), closes = []; let tgt = 0, stp = 0, nei = 0, green = 0, sumR = 0;
  for (let n = 0; n < replays; n++) {
    let pc = entry, res = 0, out = "N";
    for (let i = startI + 1; i <= endI; i++) {
      const cand = []; for (let k = Math.max(1, i - window); k <= Math.min(74, i + window); k++) cand.push(...pool[k]); if (!cand.length) continue;
      const r = cand[Math.floor(R() * cand.length)], hi = pc * r[1], lo = pc * r[2], cl = pc * r[3];
      const hitS = d === 1 ? lo <= stop : hi >= stop, hitT = d === 1 ? hi >= target : lo <= target;
      if (hitS) { out = "S"; res = -1; break; } if (hitT) { out = "T"; res = Math.abs(target - entry) / risk; break; }
      pc = cl;
    }
    if (out === "N") res = ((pc - entry) * d) / risk;
    if (out === "T") tgt++; else if (out === "S") stp++; else nei++;
    if (out === "T" || (out === "N" && res > 0)) green++; sumR += res; closes.push(pc);
  }
  closes.sort((x, y) => x - y); const q = (p) => closes[Math.min(closes.length - 1, Math.floor(p * closes.length))];
  // history: the same % distances applied on every past session from the same bar
  const sp = Math.abs(entry - stop) / entry, tp = Math.abs(target - entry) / entry; let hT = 0, hS = 0, hN = 0, hR = 0;
  for (const { a } of full) {
    const e = a[startI]?.close; if (!e) continue; const st = e * (1 - d * sp), tg = e * (1 + d * tp); let out = "N", last = e;
    for (let i = startI + 1; i <= endI; i++) { if (!a[i]) continue; last = a[i].close; const s = d === 1 ? a[i].low <= st : a[i].high >= st, t = d === 1 ? a[i].high >= tg : a[i].low <= tg; if (s) { out = "S"; break; } if (t) { out = "T"; break; } }
    if (out === "T") { hT++; hR += tp / sp; } else if (out === "S") { hS++; hR -= 1; } else { hN++; hR += ((last - e) * d) / (e * sp); }
  }
  const rr = Math.abs(target - entry) / risk, need = 1 / (1 + rr), hit = tgt + stp, share = hit ? tgt / hit : 0, gap = share - need;
  const verdict = !hit ? "Almost no replay hit either side before the cut-off." : Math.abs(gap) < 0.05 ? (Math.abs(rr - 1) < 0.03 ? "Close to a coin flip" : "Close to break-even") : gap >= 0.15 ? "Strongly toward the target" : gap > 0 ? "Leans toward the target" : gap <= -0.15 ? "Strongly toward the stop" : "Leans toward the stop";
  const pct = (x) => +(100 * x / replays).toFixed(1);
  return { sessions: full.length, replays, seed, entryBar: startI, untilBar: endI, rr: +rr.toFixed(2), targetFirstPct: pct(tgt), stopFirstPct: pct(stp), neitherPct: pct(nei), greenPct: pct(green), avgR: +(sumR / replays).toFixed(3),
    closePrice: { median: +q(0.5).toFixed(2), p5: +q(0.05).toFixed(2), p95: +q(0.95).toFixed(2) }, history: { sessions: hT + hS + hN, target: hT, stop: hS, neither: hN, avgR: +(hR / Math.max(1, hT + hS + hN)).toFixed(3) },
    breakEvenTargetShare: +(100 * need).toFixed(1), targetShareOfHits: +(100 * share).toFixed(1), verdict,
    note: "Simulation built from this stock's last ~60 sessions, not a prediction. Gaps through the stop count as -1R here; real fills can be worse. Earnings/news can do what those sessions never did." };
}
