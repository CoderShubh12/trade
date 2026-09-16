// components/ExecutionDeck.jsx
"use client";

import { fmt } from "@/lib/utils";

export default function ExecutionDeck({
  symbol = "STOCK",
  token,
  exchangeSegment = 1,
  currentPrice = 0,
  entryPrice,
  side = "BUY",
  levels = {},
  atr = 1,
  score = 0,
  volumeData = { current: 0, average: 0 },
  onManualExit,
  isLiveTrade = false, // True jab actual trade record active ho
}) {
  const isBuy = side === "BUY";

  // 🔒 Fix: Live trade me currentPrice ko entry kabhi mat maano, levels.entry strictly freeze rahega
  const effectiveEntry = Number(
    levels.entry || entryPrice || (isLiveTrade ? 0 : currentPrice),
  );
  const effectiveSl = Number(levels.stopLoss || levels.sl || 0);
  const effectiveT1 = Number(levels.target1 || levels.t1 || 0);
  const effectiveT2 = Number(levels.target2 || levels.t2 || 0);

  // Position Sizing (Fixed ₹1,000 Risk per trade on ₹1,00,000 Capital)
  const maxRiskAmount = 1000;
  const perShareRisk = Math.max(0.5, Math.abs(effectiveEntry - effectiveSl));
  const suggestedQty = Math.max(1, Math.floor(maxRiskAmount / perShareRisk));
  const totalMarginRequired = Math.round(
    (suggestedQty * (effectiveEntry || currentPrice)) / 5,
  ); // 5x MIS Leverage

  // Real-Time PnL Calculation (Sirf active positions par live tick se track hoga)
  const pnlPerShare = isLiveTrade
    ? isBuy
      ? currentPrice - effectiveEntry
      : effectiveEntry - currentPrice
    : 0;
  const totalPnL = Number((pnlPerShare * suggestedQty).toFixed(2));
  const pnlPercent = Number(
    ((pnlPerShare / (effectiveEntry || 1)) * 100).toFixed(2),
  );
  const isProfit = totalPnL >= 0;

  // Target 1 Milestone Progress
  const targetDistance = Math.abs(effectiveT1 - effectiveEntry);
  const currentProgress =
    isLiveTrade && targetDistance > 0
      ? Math.min(100, Math.max(0, (pnlPerShare / targetDistance) * 100))
      : 0;

  return (
    <section
      style={{
        margin: "16px 0",
        padding: "16px 20px",
        background: "#080d1a",
        border: `1px solid ${isBuy ? "#2FD98A40" : "#FF5D5D40"}`,
        borderRadius: "8px",
        boxShadow: `0 4px 20px ${isBuy ? "rgba(47, 217, 138, 0.05)" : "rgba(255, 93, 93, 0.05)"}`,
      }}
    >
      {/* Header Deck Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          borderBottom: "1px solid #1e293b",
          paddingBottom: "12px",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "4px",
              background: isLiveTrade
                ? isBuy
                  ? "#2FD98A"
                  : "#FF5D5D"
                : "#f59e0b",
              color: "#000",
              fontWeight: 800,
              fontSize: "0.8rem",
              letterSpacing: "0.5px",
            }}
          >
            {isLiveTrade
              ? `ACTIVE ${side} POSITION`
              : `POTENTIAL ${side} BREAKOUT`}
          </span>

          <span style={{ fontSize: "1rem", fontWeight: 800, color: "#f8fafc" }}>
            {symbol}
          </span>

          <span
            style={{
              fontSize: "0.75rem",
              color: "#94a3b8",
              fontFamily: "monospace",
              background: "#0f172a",
              padding: "2px 8px",
              borderRadius: "4px",
              border: "1px solid #334155",
            }}
          >
            LTP: ₹{fmt(currentPrice)}
          </span>
        </div>

        {/* Live Floating P&L Tracker */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: "0.68rem",
                color: "#94a3b8",
                textTransform: "uppercase",
              }}
            >
              Floating P&L ({suggestedQty} Qty)
            </div>
            <div
              style={{
                fontSize: "1.05rem",
                fontWeight: 800,
                color: !isLiveTrade
                  ? "#94a3b8"
                  : isProfit
                    ? "#2FD98A"
                    : "#FF5D5D",
                fontFamily: "monospace",
              }}
            >
              {!isLiveTrade
                ? "₹0.00 (Pending Entry)"
                : `${isProfit ? "+" : ""}₹${fmt(totalPnL)} (${isProfit ? "+" : ""}${pnlPercent}%)`}
            </div>
          </div>

          {onManualExit && isLiveTrade && (
            <button
              onClick={onManualExit}
              style={{
                background: "rgba(255, 93, 93, 0.15)",
                color: "#FF5D5D",
                border: "1px solid #FF5D5D",
                padding: "6px 12px",
                borderRadius: "4px",
                fontSize: "0.74rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              SQUARE OFF
            </button>
          )}
        </div>
      </div>

      {/* Primary Execution Matrix Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        {/* Entry Level */}
        <div
          style={{
            padding: "10px 12px",
            background: "#0f172a",
            borderRadius: "6px",
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
            LOCKED ENTRY
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#f8fafc",
              marginTop: "2px",
            }}
          >
            ₹{fmt(effectiveEntry)}
          </div>
          <div style={{ fontSize: "0.65rem", color: "#64748b" }}>
            Trigger Benchmark
          </div>
        </div>

        {/* Hard Stop Loss */}
        <div
          style={{
            padding: "10px 12px",
            background: "#0f172a",
            borderRadius: "6px",
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#f87171" }}>
            STOP LOSS (SL)
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#FF5D5D",
              marginTop: "2px",
            }}
          >
            ₹{fmt(effectiveSl)}
          </div>
          <div style={{ fontSize: "0.65rem", color: "#fca5a5" }}>
            Risk: ₹{fmt(Math.abs(effectiveEntry - effectiveSl))}
          </div>
        </div>

        {/* Target 1 */}
        <div
          style={{
            padding: "10px 12px",
            background: "#0f172a",
            borderRadius: "6px",
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#38bdf8" }}>
            TARGET 1 (TRAIL SL)
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#38bdf8",
              marginTop: "2px",
            }}
          >
            ₹{fmt(effectiveT1)}
          </div>
          <div style={{ fontSize: "0.65rem", color: "#7dd3fc" }}>
            Gain: +₹{fmt(Math.abs(effectiveT1 - effectiveEntry))}
          </div>
        </div>

        {/* Target 2 */}
        <div
          style={{
            padding: "10px 12px",
            background: "#0f172a",
            borderRadius: "6px",
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#2FD98A" }}>
            TARGET 2 (MAX EXP)
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#2FD98A",
              marginTop: "2px",
            }}
          >
            ₹{fmt(effectiveT2)}
          </div>
          <div style={{ fontSize: "0.65rem", color: "#86efac" }}>
            Gain: +₹{fmt(Math.abs(effectiveT2 - effectiveEntry))}
          </div>
        </div>

        {/* Sizing & Leverage */}
        <div
          style={{
            padding: "10px 12px",
            background: "#0f172a",
            borderRadius: "6px",
            border: "1px solid #1e293b",
          }}
        >
          <div style={{ fontSize: "0.68rem", color: "#c084fc" }}>
            MIS POSITION SIZE
          </div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: 800,
              color: "#e2e8f0",
              marginTop: "2px",
            }}
          >
            {suggestedQty} Shares
          </div>
          <div style={{ fontSize: "0.65rem", color: "#94a3b8" }}>
            Margin: ₹{fmt(totalMarginRequired)} (5x)
          </div>
        </div>
      </div>

      {/* Target Progress Bar */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.7rem",
            color: "#94a3b8",
            marginBottom: "4px",
          }}
        >
          <span>T1 Milestone Momentum</span>
          <span>
            {isLiveTrade && currentProgress > 0
              ? `${currentProgress.toFixed(1)}%`
              : "Pending Breakout"}
          </span>
        </div>
        <div
          style={{
            width: "100%",
            height: "6px",
            background: "#1e293b",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${currentProgress}%`,
              height: "100%",
              background: isProfit ? "#2FD98A" : "#FF5D5D",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      </div>
    </section>
  );
}
