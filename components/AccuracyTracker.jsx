// components/AccuracyTracker.jsx
"use client";

import { useState, useEffect } from "react";
import { fmt } from "@/lib/utils";

export default function AccuracyTracker({ activeAlert, currentPrice }) {
  const [history, setHistory] = useState([]);

  // Load initial logs from localStorage
  const loadTrackerData = () => {
    try {
      const saved = localStorage.getItem("terminal_simple_watchlist");
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadTrackerData();

    // Listen to storage changes if added from Execution Deck
    const handleStorageUpdate = () => loadTrackerData();
    window.addEventListener("storage", handleStorageUpdate);
    return () => window.removeEventListener("storage", handleStorageUpdate);
  }, []);

  // 1. Automatically append fresh system alerts if triggered
  useEffect(() => {
    if (!activeAlert || !["BUY", "SELL"].includes(activeAlert.type)) return;

    const newCall = {
      id: Date.now(),
      symbol: activeAlert.symbol,
      side: activeAlert.type,
      entryPrice: activeAlert.price,
      target1: activeAlert.levels?.target1 || 0,
      sl: activeAlert.levels?.stopLoss || 0,
      time: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "RUNNING",
    };

    setHistory((prev) => {
      const exists = prev.some(
        (item) => item.symbol === newCall.symbol && item.status === "RUNNING",
      );
      if (exists) return prev;
      const updated = [newCall, ...prev].slice(0, 20);
      try {
        localStorage.setItem(
          "terminal_simple_watchlist",
          JSON.stringify(updated),
        );
      } catch (e) {}
      return updated;
    });
  }, [activeAlert]);

  // 2. Track live price to check target or SL hit for all running items
  useEffect(() => {
    if (!currentPrice || history.length === 0) return;

    setHistory((prev) => {
      let changed = false;
      const updated = prev.map((call) => {
        if (call.status !== "RUNNING") return call;

        const isBuy = call.side === "BUY";
        const hitTarget = isBuy
          ? currentPrice >= call.target1
          : currentPrice <= call.target1;
        const hitSl = isBuy ? currentPrice <= call.sl : currentPrice >= call.sl;

        if (hitTarget) {
          changed = true;
          return { ...call, status: "TARGET_HIT" };
        }
        if (hitSl) {
          changed = true;
          return { ...call, status: "SL_HIT" };
        }
        return call;
      });

      if (changed) {
        try {
          localStorage.setItem(
            "terminal_simple_watchlist",
            JSON.stringify(updated),
          );
        } catch (e) {}
      }
      return updated;
    });
  }, [currentPrice]);

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("terminal_simple_watchlist");
  };

  if (history.length === 0) return null;

  const completed = history.filter((c) => c.status !== "RUNNING");
  const wins = completed.filter((c) => c.status === "TARGET_HIT").length;
  const winRate =
    completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;

  return (
    <section
      className="card"
      style={{ marginTop: "16px", borderColor: "#334155" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h2 className="card-title" style={{ margin: 0 }}>
            🎯 LIVE CALLS ACCURACY TRACKER
          </h2>
          {completed.length > 0 && (
            <span
              style={{
                fontSize: "0.72rem",
                padding: "2px 8px",
                borderRadius: "4px",
                background:
                  winRate >= 50
                    ? "rgba(47, 217, 138, 0.15)"
                    : "rgba(255, 93, 93, 0.15)",
                color: winRate >= 50 ? "#2FD98A" : "#FF5D5D",
                fontWeight: 800,
              }}
            >
              Win Rate: {winRate}% ({wins}/{completed.length})
            </span>
          )}
        </div>

        <button
          onClick={clearHistory}
          style={{
            background: "transparent",
            border: "1px solid #334155",
            color: "#94a3b8",
            padding: "3px 8px",
            borderRadius: "4px",
            fontSize: "0.68rem",
            cursor: "pointer",
          }}
        >
          Clear Log
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          maxHeight: "200px",
          overflowY: "auto",
        }}
      >
        {history.map((call) => {
          const isBuy = call.side === "BUY";
          let badgeBg = "rgba(245, 184, 65, 0.15)";
          let badgeColor = "#F5B841";
          let statusText = "⚡ RUNNING";

          if (call.status === "TARGET_HIT") {
            badgeBg = "rgba(47, 217, 138, 0.15)";
            badgeColor = "#2FD98A";
            statusText = "🎯 TARGET HIT";
          } else if (call.status === "SL_HIT") {
            badgeBg = "rgba(255, 93, 93, 0.15)";
            badgeColor = "#FF5D5D";
            statusText = "🛑 STOP LOSS";
          }

          return (
            <div
              key={call.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                background: "rgba(0,0,0,0.25)",
                borderRadius: "6px",
                borderLeft: `3px solid ${isBuy ? "#2FD98A" : "#FF5D5D"}`,
                fontSize: "0.78rem",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
                <span
                  style={{
                    fontWeight: 800,
                    color: isBuy ? "#2FD98A" : "#FF5D5D",
                    minWidth: "36px",
                  }}
                >
                  {call.side}
                </span>
                <span style={{ fontWeight: 700, color: "#fff" }}>
                  {call.symbol}
                </span>
                <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>
                  Entry: ₹{fmt(call.entryPrice)}
                </span>
              </div>

              <div
                style={{ display: "flex", alignItems: "center", gap: "14px" }}
              >
                <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
                  {call.time}
                </span>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: badgeBg,
                    color: badgeColor,
                    fontWeight: 700,
                    fontSize: "0.7rem",
                  }}
                >
                  {statusText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
