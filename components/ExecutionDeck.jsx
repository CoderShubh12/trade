// components/ExecutionDeck.jsx
"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/utils";

export default function ExecutionDeck({
  symbol,
  token,
  exchangeSegment = 1,
  currentPrice = 0,
  side = "BUY",
  levels = {},
  atr = 1.5,
  score = 0,
}) {
  const [maxRisk, setMaxRisk] = useState(1000);
  const [addedStatus, setAddedStatus] = useState(false);

  const price = Number(currentPrice) || 0;
  const safeAtr = Number(atr) > 0 ? Number(atr) : price * 0.01;

  const tradeLevels = useMemo(() => {
    const isBuy = side.toUpperCase() === "BUY";
    const slDist = safeAtr * 1.5;

    const stopLoss =
      Number(levels?.stopLoss || levels?.sl) ||
      (isBuy ? price - slDist : price + slDist);

    const target1 =
      Number(levels?.target1) ||
      (isBuy ? price + slDist * 1.5 : price - slDist * 1.5);

    const target2 =
      Number(levels?.target2) ||
      (isBuy ? price + slDist * 2.5 : price - slDist * 2.5);

    const riskPerShare = Math.max(0.05, Math.abs(price - stopLoss));

    return {
      stopLoss,
      target1,
      target2,
      riskPerShare,
    };
  }, [price, side, safeAtr, levels]);

  const quantity = useMemo(() => {
    if (tradeLevels.riskPerShare <= 0) return 0;
    return Math.floor(maxRisk / tradeLevels.riskPerShare);
  }, [maxRisk, tradeLevels.riskPerShare]);

  const totalCapitalRequired = Math.round(quantity * price);
  const isBuy = side.toUpperCase() === "BUY";
  const themeColor = isBuy ? "#2FD98A" : "#FF5D5D";

  // ⭐️ Manual Add to Simple Watchlist Tracker
  const handleAddToTracker = () => {
    try {
      const saved = localStorage.getItem("terminal_simple_watchlist");
      const list = saved ? JSON.parse(saved) : [];

      // Check if already running
      const exists = list.some(
        (item) => item.symbol === symbol && item.status === "RUNNING",
      );
      if (exists) {
        setAddedStatus(true);
        setTimeout(() => setAddedStatus(false), 2000);
        return;
      }

      const newEntry = {
        id: Date.now(),
        symbol: symbol,
        token: token || "0",
        exchangeSegment: exchangeSegment,
        side: side.toUpperCase(),
        entryPrice: price,
        target1: tradeLevels.target1,
        sl: tradeLevels.stopLoss,
        status: "RUNNING",
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      const updated = [newEntry, ...list];
      localStorage.setItem(
        "terminal_simple_watchlist",
        JSON.stringify(updated),
      );

      setAddedStatus(true);
      setTimeout(() => setAddedStatus(false), 2000);

      // Trigger a custom event so the tracker component updates immediately
      window.dispatchEvent(new Event("storage_watchlist_updated"));
    } catch (e) {
      console.warn("Could not add to tracker:", e);
    }
  };

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px",
        background: "rgba(15, 23, 42, 0.7)",
        border: `1px solid ${themeColor}40`,
        borderRadius: "8px",
      }}
    >
      {/* Header Info */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              padding: "4px 10px",
              background: `${themeColor}20`,
              border: `1px solid ${themeColor}`,
              borderRadius: "4px",
              color: themeColor,
              fontWeight: 800,
              fontSize: "0.85rem",
              letterSpacing: "0.04em",
            }}
          >
            ACTIVE SETUP: {side} // {symbol}
          </span>
          <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
            Score:{" "}
            <strong style={{ color: themeColor }}>
              {score > 0 ? `+${score}` : score} pts
            </strong>
          </span>

          {/* ⭐️ Add to Tracker Button */}
          <button
            onClick={handleAddToTracker}
            style={{
              background: addedStatus
                ? "rgba(47, 217, 138, 0.2)"
                : "rgba(59, 130, 246, 0.15)",
              border: `1px solid ${
                addedStatus ? "#2FD98A" : "rgba(59, 130, 246, 0.4)"
              }`,
              color: addedStatus ? "#2FD98A" : "#60a5fa",
              padding: "3px 10px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {addedStatus ? "✓ Added to Tracker" : "+ Add to Tracker"}
          </button>
        </div>

        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
          <span>ATR(14): ₹{fmt(safeAtr)}</span> |{" "}
          <span>
            LTP:{" "}
            <strong style={{ color: "#f8fafc", fontFamily: "monospace" }}>
              ₹{fmt(price)}
            </strong>
          </span>
        </div>
      </div>

      {/* Execution Cards Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "12px",
        }}
      >
        {/* Stop Loss Card */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 93, 93, 0.3)",
            borderRadius: "6px",
            padding: "10px 12px",
          }}
        >
          <span
            style={{ fontSize: "0.68rem", color: "#94a3b8", display: "block" }}
          >
            STOP LOSS (SL)
          </span>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#FF5D5D",
              fontFamily: "monospace",
            }}
          >
            ₹{fmt(tradeLevels.stopLoss)}
          </span>
          <span
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              display: "block",
              marginTop: "2px",
            }}
          >
            Risk: ₹{fmt(tradeLevels.riskPerShare)}/sh
          </span>
        </div>

        {/* Target 1 Card */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(47, 217, 138, 0.3)",
            borderRadius: "6px",
            padding: "10px 12px",
          }}
        >
          <span
            style={{ fontSize: "0.68rem", color: "#94a3b8", display: "block" }}
          >
            TARGET 1 (1:1.5 RR)
          </span>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#2FD98A",
              fontFamily: "monospace",
            }}
          >
            ₹{fmt(tradeLevels.target1)}
          </span>
          <span
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              display: "block",
              marginTop: "2px",
            }}
          >
            Move: {isBuy ? "+" : "-"}₹
            {fmt(Math.abs(tradeLevels.target1 - price))}
          </span>
        </div>

        {/* Target 2 Card */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(47, 217, 138, 0.3)",
            borderRadius: "6px",
            padding: "10px 12px",
          }}
        >
          <span
            style={{ fontSize: "0.68rem", color: "#94a3b8", display: "block" }}
          >
            TARGET 2 (1:2.5 RR)
          </span>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#2FD98A",
              fontFamily: "monospace",
            }}
          >
            ₹{fmt(tradeLevels.target2)}
          </span>
          <span
            style={{
              fontSize: "0.68rem",
              color: "#64748b",
              display: "block",
              marginTop: "2px",
            }}
          >
            Move: {isBuy ? "+" : "-"}₹
            {fmt(Math.abs(tradeLevels.target2 - price))}
          </span>
        </div>

        {/* Risk & Position Sizer Card */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid #334155",
            borderRadius: "6px",
            padding: "10px 12px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
              MAX RISK (₹)
            </span>
            <input
              type="number"
              value={maxRisk}
              onChange={(e) => setMaxRisk(Number(e.target.value) || 0)}
              style={{
                width: "70px",
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#f8fafc",
                fontSize: "0.75rem",
                padding: "2px 6px",
                borderRadius: "4px",
                textAlign: "right",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "#38bdf8",
              fontFamily: "monospace",
              display: "block",
              marginTop: "4px",
            }}
          >
            {quantity} SHARES
          </span>
          <span
            style={{ fontSize: "0.68rem", color: "#64748b", display: "block" }}
          >
            Est. Capital: ₹{totalCapitalRequired.toLocaleString("en-IN")}
          </span>
        </div>
      </div>
    </div>
  );
}
