// components/CallWatchlist.jsx
"use client";

import { useState, useEffect } from "react";
import { STOCK_POOL } from "@/lib/stockPool";
import { fmt } from "@/lib/utils";

export default function CallWatchlist({
  activeAlert,
  currentPrice,
  currentStock,
  onSelectStock,
}) {
  const [watchlist, setWatchlist] = useState([]);
  const [selectedAddSymbol, setSelectedAddSymbol] = useState("");

  const loadData = () => {
    try {
      const saved = localStorage.getItem("terminal_simple_watchlist");
      if (saved) setWatchlist(JSON.parse(saved));
    } catch (e) {}
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 1000); // Live sync
    return () => clearInterval(interval);
  }, []);

  const saveToStorage = (updated) => {
    setWatchlist(updated);
    try {
      localStorage.setItem(
        "terminal_simple_watchlist",
        JSON.stringify(updated),
      );
    } catch (e) {}
  };

  // 1. Automatically capture tool-generated BUY/SELL calls
  useEffect(() => {
    if (!activeAlert || !["BUY", "SELL"].includes(activeAlert.type)) return;

    const newEntry = {
      id: Date.now(),
      symbol: activeAlert.symbol || currentStock?.symbol,
      token: currentStock?.token,
      exchangeSegment: currentStock?.exchangeSegment || 1,
      side: activeAlert.type,
      entryPrice: activeAlert.price || currentPrice,
      target1:
        activeAlert.levels?.target1 ||
        (activeAlert.type === "BUY"
          ? (activeAlert.price || currentPrice) * 1.015
          : (activeAlert.price || currentPrice) * 0.985),
      sl:
        activeAlert.levels?.stopLoss ||
        (activeAlert.type === "BUY"
          ? (activeAlert.price || currentPrice) * 0.99
          : (activeAlert.price || currentPrice) * 1.01),
      status: "RUNNING",
      time: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setWatchlist((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(item.symbol === newEntry.symbol && item.status === "RUNNING"),
      );
      const updated = [newEntry, ...filtered];
      saveToStorage(updated);
      return updated;
    });
  }, [activeAlert]);

  // 2. Manual Add from Dropdown
  const handleManualAdd = (e) => {
    e.preventDefault();
    if (!selectedAddSymbol) return;

    const foundStock = STOCK_POOL.find(
      (s) => s.symbol === selectedAddSymbol,
    ) || {
      symbol: selectedAddSymbol,
      token: currentStock?.token || "0",
      segment: 1,
    };

    const entry =
      currentStock?.symbol === foundStock.symbol
        ? currentPrice
        : foundStock.baseBand || 100;

    const newEntry = {
      id: Date.now(),
      symbol: foundStock.symbol,
      token: String(foundStock.token),
      exchangeSegment: foundStock.segment || 1,
      side: "BUY",
      entryPrice: entry,
      target1: entry * 1.015,
      sl: entry * 0.99,
      status: "RUNNING",
      time: new Date().toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setWatchlist((prev) => {
      const updated = [newEntry, ...prev];
      saveToStorage(updated);
      return updated;
    });
    setSelectedAddSymbol("");
  };

  // 3. Track live price to check target or SL hit
  useEffect(() => {
    if (!currentPrice || watchlist.length === 0) return;

    setWatchlist((prev) => {
      let changed = false;
      const updated = prev.map((item) => {
        if (item.status !== "RUNNING") return item;
        if (item.symbol !== currentStock?.symbol) return item;

        const isBuy = item.side === "BUY";
        const hitTarget = isBuy
          ? currentPrice >= item.target1
          : currentPrice <= item.target1;
        const hitSl = isBuy ? currentPrice <= item.sl : currentPrice >= item.sl;

        if (hitTarget) {
          changed = true;
          return { ...item, status: "TARGET_HIT" };
        }
        if (hitSl) {
          changed = true;
          return { ...item, status: "SL_HIT" };
        }
        return item;
      });

      if (changed) {
        saveToStorage(updated);
      }
      return updated;
    });
  }, [currentPrice, currentStock?.symbol]);

  const handleRemove = (id, e) => {
    e.stopPropagation();
    const updated = watchlist.filter((item) => item.id !== id);
    saveToStorage(updated);
  };

  // Win Rate Calculation
  const completed = watchlist.filter((c) => c.status !== "RUNNING");
  const wins = completed.filter((c) => c.status === "TARGET_HIT").length;
  const winRate =
    completed.length > 0 ? Math.round((wins / completed.length) * 100) : 0;

  return (
    <section
      className="card"
      style={{ marginTop: "16px", borderColor: "#3b82f640" }}
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
          <h2 className="card-title" style={{ margin: 0, color: "#60a5fa" }}>
            🎯 ACTIVE CALLS & ACCURACY TRACKER
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

        {/* Manual Add Form */}
        <form
          onSubmit={handleManualAdd}
          style={{ display: "flex", gap: "6px" }}
        >
          <select
            value={selectedAddSymbol}
            onChange={(e) => setSelectedAddSymbol(e.target.value)}
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#f8fafc",
              padding: "4px 8px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              outline: "none",
            }}
          >
            <option value="">+ Add Stock to Track</option>
            {STOCK_POOL.map((st) => (
              <option key={st.token} value={st.symbol}>
                {st.symbol}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              background: "#0284c7",
              color: "#fff",
              border: "none",
              padding: "4px 12px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </form>
      </div>

      {watchlist.length === 0 ? (
        <div
          style={{
            padding: "12px 0",
            textAlign: "center",
            color: "#64748b",
            fontSize: "0.78rem",
          }}
        >
          No calls tracked yet. Use '+ Add to Tracker' on any active setup or
          add manually above.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {watchlist.map((item) => {
            const isBuy = item.side === "BUY";
            let badgeBg = "rgba(245, 184, 65, 0.15)";
            let badgeColor = "#F5B841";
            let statusText = "⚡ RUNNING";

            if (item.status === "TARGET_HIT") {
              badgeBg = "rgba(47, 217, 138, 0.15)";
              badgeColor = "#2FD98A";
              statusText = "🎯 TARGET HIT";
            } else if (item.status === "SL_HIT") {
              badgeBg = "rgba(255, 93, 93, 0.15)";
              badgeColor = "#FF5D5D";
              statusText = "🛑 STOP LOSS";
            }

            return (
              <div
                key={item.id}
                onClick={() =>
                  item.token &&
                  onSelectStock({
                    symbol: item.symbol,
                    token: item.token,
                    exchangeSegment: item.exchangeSegment,
                  })
                }
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "rgba(15, 23, 42, 0.5)",
                  borderRadius: "6px",
                  borderLeft: `3px solid ${isBuy ? "#2FD98A" : "#FF5D5D"}`,
                  cursor: "pointer",
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
                    {item.side}
                  </span>
                  <span style={{ fontWeight: 700, color: "#fff" }}>
                    {item.symbol}
                  </span>
                  <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>
                    Entry: ₹{fmt(item.entryPrice)}
                  </span>
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "14px" }}
                >
                  <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
                    {item.time}
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
                  <button
                    onClick={(e) => handleRemove(item.id, e)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      fontSize: "0.8rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
