"use client";
// Confluence Ribbon: one row per factor + a total strip, one cell per 5m bar (green = bullish, red = bearish). Shows how many factors agree over time.
// Descriptive only: our test found the score does not predict the next 30 min (analysis/confluence_test.py).
import { useMemo } from "react";
import { confluence } from "@/lib/confluence";
const col = (v) => (v > 0 ? `rgba(34,197,94,${0.25 + 0.15 * Math.min(v, 4)})` : v < 0 ? `rgba(239,68,68,${0.25 + 0.15 * Math.min(-v, 4)})` : "#1e293b");
export default function ConfluenceStrip({ data, visibleBars = 90 }) {
  const rows = useMemo(() => confluence(data), [data]);
  if (!rows.length) return null;
  const view = rows.slice(-visibleBars), last = view[view.length - 1], names = Object.keys(last.factors), W = 1000, cw = W / view.length;
  const H = 12, G = 3, total = (names.length + 1) * (H + G);
  const bull = names.filter((n) => last.factors[n] > 0), bear = names.filter((n) => last.factors[n] < 0);
  return (
    <div className="card" style={{ marginTop: 8, padding: "8px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, flexWrap: "wrap", gap: 6 }}>
        <b>🧭 Confluence ribbon</b>
        <span>Now {last.clock}: <b style={{ color: last.score > 0 ? "#22c55e" : last.score < 0 ? "#ef4444" : "#94a3b8" }}>{last.score > 0 ? "+" : ""}{last.score} / 6</b>{bull.length ? ` · bullish: ${bull.join(", ")}` : ""}{bear.length ? ` · bearish: ${bear.join(", ")}` : ""}</span>
      </div>
      <svg viewBox={`0 0 ${W + 70} ${total}`} style={{ width: "100%", height: total * 1.6 }}>
        {names.map((n, r) => (
          <g key={n}>
            <text x="0" y={r * (H + G) + 10} fontSize="9" fill="#94a3b8">{n}</text>
            {view.map((v, i) => <rect key={i} x={70 + i * (cw - 0.6 > 0 ? cw : cw)} y={r * (H + G)} width={Math.max(cw - 0.6, 0.5)} height={H} fill={col(v.factors[n])} />)}
          </g>
        ))}
        <text x="0" y={names.length * (H + G) + 10} fontSize="9" fill="#e2e8f0" fontWeight="700">TOTAL</text>
        {view.map((v, i) => <rect key={i} x={70 + i * cw} y={names.length * (H + G)} width={Math.max(cw - 0.6, 0.5)} height={H} fill={col(v.score)} />)}
      </svg>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>Shows how many of 6 factors agree, bar by bar. It describes the current state only: in our 152k-bar test the score did not predict the next 30 minutes.</div>
    </div>
  );
}
