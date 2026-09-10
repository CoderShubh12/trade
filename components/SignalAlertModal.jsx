"use client";

import { fmt } from "@/lib/utils";

export default function SignalAlertModal({ alert, onClose }) {
  if (!alert) return null;

  const isBuy = alert.type === "BUY";
  const accentColor = isBuy ? "#2FD98A" : "#FF5D5D";

  // Support both key-naming conventions safely
  const sl = alert.levels?.sl ?? alert.levels?.stopLoss;
  const t1 = alert.levels?.t1 ?? alert.levels?.target1;
  const t2 = alert.levels?.t2 ?? alert.levels?.target2;
  const risk = alert.levels?.risk;
  const reward1 = alert.levels?.reward1;
  const reward2 = alert.levels?.reward2;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "#0e131f",
          border: `1.5px solid ${accentColor}`,
          boxShadow: `0 0 30px ${accentColor}30`,
          borderRadius: "12px",
          width: "420px",
          padding: "24px",
          position: "relative",
        }}
      >
        {/* Top Badges & Close */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "20px",
              border: `1px solid ${accentColor}`,
              color: accentColor,
              background: isBuy
                ? "rgba(47, 217, 138, 0.15)"
                : "rgba(255, 93, 93, 0.15)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ● {isBuy ? "STRONG BUY SETUP" : "STRONG SELL SETUP"}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#64748b",
              fontSize: "1.2rem",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Symbol & Trigger Price */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "20px",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "1.35rem",
                color: "#fff",
                fontWeight: 800,
              }}
            >
              {alert.symbol}
            </h2>
            <span
              style={{
                fontSize: "0.68rem",
                color: "#64748b",
                letterSpacing: "0.05em",
              }}
            >
              TRIGGER PRICE
            </span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "#fff" }}>
            ₹{fmt(alert.price)}
          </div>
        </div>

        {/* Level Rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: "20px",
          }}
        >
          {/* Stop Loss */}
          <div
            style={{
              background: "rgba(255, 93, 93, 0.08)",
              border: "1px solid rgba(255, 93, 93, 0.2)",
              borderRadius: "6px",
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                background: "rgba(255, 93, 93, 0.2)",
                color: "#FF5D5D",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              STOP LOSS
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
              ₹{sl !== undefined ? fmt(sl) : "—"}
            </span>
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              ({risk ? `-${risk}` : "—"})
            </span>
          </div>

          {/* Target 1 */}
          <div
            style={{
              background: "rgba(47, 217, 138, 0.08)",
              border: "1px solid rgba(47, 217, 138, 0.2)",
              borderRadius: "6px",
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                background: "rgba(47, 217, 138, 0.2)",
                color: "#2FD98A",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              TARGET 1 (1:1.5)
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
              ₹{t1 !== undefined ? fmt(t1) : "—"}
            </span>
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              ({reward1 ? `+${reward1}` : "—"})
            </span>
          </div>

          {/* Target 2 */}
          <div
            style={{
              background: "rgba(47, 217, 138, 0.08)",
              border: "1px solid rgba(47, 217, 138, 0.2)",
              borderRadius: "6px",
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                background: "rgba(47, 217, 138, 0.2)",
                color: "#2FD98A",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              TARGET 2 (1:2.5)
            </span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>
              ₹{t2 !== undefined ? fmt(t2) : "—"}
            </span>
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              ({reward2 ? `+${reward2}` : "—"})
            </span>
          </div>
        </div>

        {/* Quick Context Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            marginBottom: "20px",
            fontSize: "0.75rem",
          }}
        >
          <div>
            <div style={{ color: "#64748b" }}>Risk : Reward</div>
            <div style={{ color: "#2FD98A", fontWeight: 600 }}>1:2.5</div>
          </div>
          <div>
            <div style={{ color: "#64748b" }}>Volatility ATR</div>
            <div style={{ color: "#fff", fontWeight: 600 }}>
              ₹{fmt(alert.atr)}
            </div>
          </div>
          <div>
            <div style={{ color: "#64748b" }}>VWAP</div>
            <div style={{ color: "#fff", fontWeight: 600 }}>
              ₹{fmt(alert.vwap)}
            </div>
          </div>
          <div>
            <div style={{ color: "#64748b" }}>Bias Score</div>
            <div style={{ color: accentColor, fontWeight: 700 }}>
              {alert.score > 0 ? `+${alert.score}` : alert.score}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "12px",
            background: accentColor,
            color: "#0a0d14",
            border: "none",
            borderRadius: "8px",
            fontWeight: 700,
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Acknowledge Trade Setup
        </button>
      </div>
    </div>
  );
}
