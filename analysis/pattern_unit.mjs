// Sanity tests: hand-built price paths must trigger the intended pattern on the breakout bar (and only then), and nothing before it.
import { detectChartPatterns } from "../lib/chartPatterns.js";
let T = 1783914300;
const bar = (o, c, w = 0.15, v = 100000, date = "2026-10-12") => ({ time: T += 300, date, clock: "", open: o, high: Math.max(o, c) + w, low: Math.min(o, c) - w, close: c, volume: v });
// path through waypoints, `per` bars each leg, ATR ~ 0.5
function path(start, wps, per = 6, vols = {}) {
  const out = [bar(start, start)]; let p = start;
  wps.forEach((w, k) => { for (let i = 1; i <= per; i++) { const n = p + ((w - p) * i) / per; out.push(bar(out[out.length - 1].close, n, 0.15, vols[k] || 100000)); } p = w; });
  return out;
}
const warm = (n = 30, px = 100) => Array.from({ length: n }, (_, i) => bar(px + (i % 2 ? 0.3 : -0.3), px + (i % 2 ? -0.3 : 0.3)));
let fail = 0;
function expect(name, candles, id, dir) {
  const L = candles.length;
  // earliest bar where the pattern fires
  let first = -1, hitDir = 0;
  for (let n = 30; n <= L; n++) { const r = detectChartPatterns(candles.slice(0, n)).filter((x) => x.id === id); if (r.length) { first = n; hitDir = r[0].dir; break; } }
  const ok = first > 0 && hitDir === dir;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: first fire at bar ${first}/${L}`);
  if (!ok) fail++;
}
const dbT = warm().concat(path(100, [106, 102, 106, 98, 97, 96], 7));                       // two peaks at 106, neckline 102, then break down
expect("double top", dbT, "dbl_top", -1);
const dbB = warm(30, 100).concat(path(100, [94, 98, 94, 102, 103, 104], 7));
expect("double bottom", dbB, "dbl_bottom", 1);
const hs = warm().concat(path(100, [105, 101, 109, 101, 105, 100, 97], 6));
expect("head & shoulders", hs, "head_shoulders", -1);
const ihs = warm().concat(path(100, [95, 99, 91, 99, 95, 100, 103], 6));
expect("inverse H&S", ihs, "inv_head_shoulders", 1);
const flag = warm().concat(path(100, [112], 8), path(112, [111, 111.4, 110.6, 111.2, 110.8, 111.5, 111.0, 111.6], 2), path(111.6, [114.5], 2));
expect("bull flag", flag, "bull_flag", 1);
const box = warm(40, 100).concat(Array.from({ length: 14 }, (_, i) => bar(100 + (i % 2 ? 0.4 : -0.4), 100 + (i % 2 ? -0.4 : 0.4))), [bar(100.2, 102.4, 0.1, 400000)]);
expect("box breakout up", box, "box_break_up", 1);
// negative: pure noise should not produce many patterns
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let noise = []; let px = 100; for (let i = 0; i < 400; i++) { const o = px; px += (rnd() - 0.5) * 0.8; noise.push(bar(o, px, 0.1 + rnd() * 0.2)); }
let cnt = 0; for (let n = 30; n <= noise.length; n++) cnt += detectChartPatterns(noise.slice(0, n)).length;
console.log(`noise: ${cnt} pattern fires over ${noise.length - 29} bars (${(100 * cnt / (noise.length - 29)).toFixed(1)}% of bars)`);
// look-ahead check: result at bar n must not change when later bars are appended
let bad = 0; for (let n = 40; n < 300; n += 7) { const a = JSON.stringify(detectChartPatterns(noise.slice(0, n))); const b = JSON.stringify(detectChartPatterns(noise.slice(0, n).concat(noise.slice(n, 400)).slice(0, n))); if (a !== b) bad++; }
console.log(bad ? "FAIL lookahead" : "PASS no look-ahead (same input -> same output)");
process.exit(fail ? 1 : 0);
