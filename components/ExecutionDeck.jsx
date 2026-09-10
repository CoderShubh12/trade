"use client";

import { fmt } from "@/lib/utils";

export default function ExecutionDeck({
  symbol,
  currentPrice,
  levels,
  side,
  atr,
  score,
  volumeData,
}) {
  if (!levels || !levels.sl) return null;

  const isBuy = side === "BUY";
  const accentColor = isBuy ? "#2FD98A" : "#FF5D5D";
  const bgBadge = isBuy
    ? "rgba(47, 217, 138, 0.12)"
    : "rgba(255, 93, 93, 0.12)";

  const curVol = volumeData?.current || 0;
  const avgVol = volumeData?.average || 1;
  const volRatio = (curVol / avgVol).toFixed(1);
  const isHighVol = curVol > avgVol * 1.5;

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px 20px",
        background: "#0c1017",
        border: `1px solid ${accentColor}40`,
        borderRadius: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              padding: "3px 10px",
              borderRadius: "4px",
              border: `1px solid ${accentColor}`,
              color: accentColor,
              background: bgBadge,
            }}
          >
            ACTIVE SETUP // {isBuy ? "LONG (BUY)" : "SHORT (SELL)"}
          </span>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: "0.95rem" }}>
            {symbol}
          </span>
          <span style={{ color: "#64748b", fontSize: "0.75rem" }}>
            LTP: <strong style={{ color: "#fff" }}>₹{fmt(currentPrice)}</strong>
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "14px",
            fontSize: "0.75rem",
            color: "#8b93a3",
          }}
        >
          <span style={{ color: isHighVol ? "#2FD98A" : "#94a3b8" }}>
            📊 Vol:{" "}
            {curVol > 100000 ? `${(curVol / 100000).toFixed(2)}L` : curVol} (
            {volRatio}x)
          </span>
          <span>
            ATR: <strong style={{ color: "#fff" }}>₹{fmt(atr)}</strong>
          </span>
          <span>
            Bias:{" "}
            <strong style={{ color: accentColor }}>
              {score > 0 ? `+${score}` : score}
            </strong>
          </span>
          <span>
            RR: <strong style={{ color: "#2FD98A" }}>1:2.5</strong>
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "10px 14px",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#64748b" }}>
            TRIGGER ENTRY
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#fff",
              marginTop: "3px",
            }}
          >
            ₹{fmt(levels.entry || currentPrice)}
          </div>
        </div>
        <div
          style={{
            background: "rgba(255, 93, 93, 0.06)",
            border: "1px solid rgba(255, 93, 93, 0.25)",
            padding: "10px 14px",
            borderRadius: "6px",
          }}
        >
          <div
            style={{ fontSize: "0.68rem", color: "#FF5D5D", fontWeight: 700 }}
          >
            HARD STOP LOSS
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#FF5D5D",
              marginTop: "3px",
            }}
          >
            ₹{fmt(levels.sl)}
          </div>
          <div
            style={{ fontSize: "0.68rem", color: "#64748b", marginTop: "2px" }}
          >
            Risk: -₹{fmt(levels.risk)}
          </div>
        </div>
        <div
          style={{
            background: "rgba(47, 217, 138, 0.05)",
            border: "1px solid rgba(47, 217, 138, 0.2)",
            padding: "10px 14px",
            borderRadius: "6px",
          }}
        >
          <div
            style={{ fontSize: "0.68rem", color: "#2FD98A", fontWeight: 700 }}
          >
            TARGET 1 (1:1.5)
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#2FD98A",
              marginTop: "3px",
            }}
          >
            ₹{fmt(levels.t1)}
          </div>
          <div
            style={{ fontSize: "0.68rem", color: "#64748b", marginTop: "2px" }}
          >
            Gain: +₹{fmt(levels.reward1)}
          </div>
        </div>
        <div
          style={{
            background: "rgba(47, 217, 138, 0.09)",
            border: "1px solid rgba(47, 217, 138, 0.35)",
            padding: "10px 14px",
            borderRadius: "6px",
          }}
        >
          <div
            style={{ fontSize: "0.68rem", color: "#2FD98A", fontWeight: 700 }}
          >
            TARGET 2 (1:2.5)
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#2FD98A",
              marginTop: "3px",
            }}
          >
            ₹{fmt(levels.t2)}
          </div>
          <div
            style={{ fontSize: "0.68rem", color: "#64748b", marginTop: "2px" }}
          >
            Gain: +₹{fmt(levels.reward2)}
          </div>
        </div>
      </div>
    </div>
  );
}
