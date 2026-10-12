// components/CurrentCallCard.jsx
// The one place to read "what is the call right now".
"use client";

import { fmt, formatRiskReward } from "@/lib/utils";

const box = {
  background: "#080d17",
  border: "1px solid #1e293b",
  borderRadius: 6,
  padding: "8px 10px",
};
const lbl = { fontSize: "0.66rem", color: "#64748b", fontWeight: 700 };

function Level({ label, value, color }) {
  return (
    <div style={box}>
      <div style={lbl}>{label}</div>
      <div style={{ color, fontFamily: "monospace", fontWeight: 800, fontSize: "0.95rem" }}>
        {value ? `₹${fmt(value)}` : "—"}
      </div>
    </div>
  );
}

export default function CurrentCallCard({
  symbol,
  ltp,
  score,
  trade, // active trade for this stock, or null
  waitReason, // why there is no call (string)
  isReplay,
  inWatchlist,
  onAddWatchlist,
}) {
  const isCall = !!trade;
  const side = trade?.side || trade?.action;
  const color = !isCall ? "#94a3b8" : side === "BUY" ? "#2FD98A" : "#FF5D5D";

  // Live result of the open call, in R (1R = distance from entry to first stop)
  let pnlText = null;
  if (isCall && ltp) {
    const dir = side === "SELL" ? -1 : 1;
    const risk = Math.abs(trade.entry - (trade.initialSl ?? trade.stopLoss)) || 1;
    const move = dir * (ltp - trade.entry);
    const r = move / risk;
    pnlText = `${move >= 0 ? "+" : "−"}₹${fmt(Math.abs(move))} / share (${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R)`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          ...box,
          border: `1px solid ${color}66`,
          background: `${color}10`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          <div style={{ ...lbl, color: "#94a3b8" }}>
            {symbol} {isReplay ? "· REPLAY" : ""}
          </div>
          <div style={{ fontSize: "1.9rem", fontWeight: 900, color, lineHeight: 1.1 }}>
            {isCall ? side : "WAIT"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={lbl}>SCORE</div>
          <div
            style={{
              fontSize: "1.3rem",
              fontWeight: 800,
              fontFamily: "monospace",
              color: score >= 0 ? "#2FD98A" : "#FF5D5D",
            }}
          >
            {score > 0 ? "+" : ""}
            {score}
          </div>
          <div style={{ fontSize: "0.62rem", color: "#64748b" }}>call at ±65</div>
        </div>
      </div>

      {isCall ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Level label="ENTRY" value={trade.entry} color="#e2e8f0" />
            <Level label="STOP LOSS" value={trade.stopLoss} color="#FF5D5D" />
            <Level
              label={`TARGET 1 (${formatRiskReward(trade.entry, trade.initialSl ?? trade.stopLoss, trade.target1)})`}
              value={trade.target1}
              color="#2FD98A"
            />
            <Level
              label={`TARGET 2 (${formatRiskReward(trade.entry, trade.initialSl ?? trade.stopLoss, trade.target2)})`}
              value={trade.target2}
              color="#22c55e"
            />
          </div>
          {pnlText && (
            <div style={{ ...box, fontFamily: "monospace", fontSize: "0.8rem", color: "#e2e8f0" }}>
              Open result: {pnlText}
              {trade.t1Reached && (
                <span style={{ color: "#2FD98A" }}> · T1 done, stop at cost</span>
              )}
            </div>
          )}
          <button
            onClick={onAddWatchlist}
            disabled={inWatchlist}
            style={{
              background: inWatchlist ? "transparent" : "rgba(251,191,36,0.12)",
              color: inWatchlist ? "#64748b" : "#fbbf24",
              border: `1px solid ${inWatchlist ? "#334155" : "#fbbf24"}`,
              borderRadius: 6,
              padding: "8px 10px",
              fontWeight: 800,
              fontSize: "0.78rem",
              cursor: inWatchlist ? "default" : "pointer",
            }}
          >
            {inWatchlist ? "★ Call saved in watchlist" : "☆ Add this call to watchlist"}
          </button>
        </>
      ) : (
        <div style={{ ...box, color: "#cbd5e1", fontSize: "0.78rem", lineHeight: 1.5 }}>
          <strong style={{ color: "#e2e8f0" }}>Why no call: </strong>
          {waitReason}
        </div>
      )}
    </div>
  );
}
