"use client";
// Range cone: the likely PRICE RANGE for the next 30 min (6 x 5m bars) from recent volatility. It does NOT predict direction.
// Calibrated on 152k bars (analysis/range_cone_test.py): the 95% band held the 30-min-ahead close 94.9% of the time, the 80% band 85.3% (a bit wide);
// the whole path stayed inside the 95% band 88% of the time. Direction showed no edge in any of our tests.
import { useMemo } from "react";
export default function RangeCone({ data }) {
  const m = useMemo(() => {
    if (!data || data.length < 40) return null;
    const bars = data.slice(-60), last = bars[bars.length - 1], day = last.date;
    const cl = data.map((b) => b.close), r = []; for (let i = Math.max(1, cl.length - 24); i < cl.length; i++) if (data[i].date === data[i - 1].date) r.push(Math.log(cl[i] / cl[i - 1]));
    if (r.length < 12) return null;
    const mean = r.reduce((a, x) => a + x, 0) / r.length, sig = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / (r.length - 1));
    const p = last.close, f = (z, k) => [p * Math.exp(-z * sig * Math.sqrt(k)), p * Math.exp(z * sig * Math.sqrt(k))];
    return { p, sig, day, hist: bars.slice(-36).map((b) => b.close), b80: f(1.2816, 6), b95: f(1.96, 6), f };
  }, [data]);
  if (!m) return null;
  const nH = m.hist.length, N = nH + 6, W = 1000, Ht = 120;
  const all = [...m.hist, ...[1, 2, 3, 4, 5, 6].flatMap((k) => [...m.f(1.96, k)])], lo = Math.min(...all), hi = Math.max(...all);
  const x = (i) => (i / (N - 1)) * W, y = (v) => Ht - 6 - ((v - lo) / (hi - lo || 1)) * (Ht - 12);
  const poly = (z, up) => [0, 1, 2, 3, 4, 5, 6].map((k) => `${x(nH - 1 + k)},${y(k === 0 ? m.p : m.f(z, k)[up ? 1 : 0])}`);
  const area = (z) => [...poly(z, true), ...poly(z, false).reverse()].join(" ");
  const pct = (v) => (((v - m.p) / m.p) * 100).toFixed(2);
  return (
    <div className="card" style={{ marginTop: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
        <b>🎯 Next-30-min range cone</b>
        <span>80%: ₹{m.b80[0].toFixed(2)} – ₹{m.b80[1].toFixed(2)} ({pct(m.b80[0])}% / +{pct(m.b80[1])}%) · 95%: ₹{m.b95[0].toFixed(2)} – ₹{m.b95[1].toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${Ht}`} style={{ width: "100%", height: 150 }}>
        <polygon points={area(1.96)} fill="rgba(56,189,248,0.15)" /><polygon points={area(1.2816)} fill="rgba(56,189,248,0.30)" />
        <polyline points={m.hist.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
        <line x1={x(nH - 1)} x2={x(N - 1)} y1={y(m.p)} y2={y(m.p)} stroke="#94a3b8" strokeDasharray="4 4" />
      </svg>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>Shows how far price is likely to move (from recent volatility), not which way. In 152k bars the 95% band held 94.9% of the time. Direction could not be predicted in any test, so this is for sizing stops and targets, not for entry signals.</div>
    </div>
  );
}
