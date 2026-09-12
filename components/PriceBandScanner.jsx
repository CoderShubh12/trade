// components/PriceBandScanner.jsx
"use client";

import { useState, useMemo } from "react";
import { fmt } from "@/lib/utils";

export default function PriceBandScanner({
  stocks = [],
  marketTicks = {},
  onSelectStock,
  activeSymbol,
}) {
  const [activeTab, setActiveTab] = useState("genuine");
  const [selectedBand, setSelectedBand] = useState("all");

  const processedData = useMemo(() => {
    return stocks.map((item) => {
      const live = marketTicks[item.token] || {
        ltp: 0,
        volume: 0,
        score: 0,
        chgPct: 0,
        isScalperSpike: false,
        isTrap: false,
      };

      let currentBand = item.baseBand;
      if (live.ltp > 0) {
        if (live.ltp < 500) currentBand = "100-500";
        else if (live.ltp <= 1500) currentBand = "500-1500";
        else currentBand = "1500+";
      }

      return {
        ...item,
        currentBand,
        ltp: live.ltp,
        score: live.score || 0,
        chgPct: live.chgPct || 0,
        volume: live.volume || 0,
        isScalperSpike: live.isScalperSpike || false,
        isTrap: live.isTrap || false,
      };
    });
  }, [stocks, marketTicks]);

  const genuineList = useMemo(() => {
    return processedData
      .filter(
        (s) =>
          !s.isTrap &&
          (selectedBand === "all" || s.currentBand === selectedBand),
      )
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 5);
  }, [processedData, selectedBand]);

  const scalperList = useMemo(() => {
    return processedData
      .filter(
        (s) =>
          (s.isScalperSpike || s.isTrap) &&
          (selectedBand === "all" || s.currentBand === selectedBand),
      )
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }, [processedData, selectedBand]);

  const currentDisplayList =
    activeTab === "genuine" ? genuineList : scalperList;

  return (
    <div
      style={{
        background: "#0d131f",
        border: "1px solid #1e293b",
        borderRadius: "8px",
        padding: "12px",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
          borderBottom: "1px solid #1e293b",
          paddingBottom: "10px",
          marginBottom: "10px",
        }}
      >
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("genuine")}
            style={{
              background:
                activeTab === "genuine"
                  ? "rgba(47, 217, 138, 0.15)"
                  : "transparent",
              border: `1px solid ${activeTab === "genuine" ? "#2FD98A" : "#334155"}`,
              color: activeTab === "genuine" ? "#2FD98A" : "#94a3b8",
              padding: "5px 12px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🔥 GENUINE TRENDS (TOP 5)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("scalper")}
            style={{
              background:
                activeTab === "scalper"
                  ? "rgba(249, 115, 22, 0.15)"
                  : "transparent",
              border: `1px solid ${activeTab === "scalper" ? "#f97316" : "#334155"}`,
              color: activeTab === "scalper" ? "#f97316" : "#94a3b8",
              padding: "5px 12px",
              borderRadius: "4px",
              fontSize: "0.72rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⚡ SCALPER INFLOW / TRAPS
          </button>
        </div>

        <div style={{ display: "flex", gap: "5px" }}>
          {[
            { id: "all", label: "ALL PRICES" },
            { id: "100-500", label: "₹100-500" },
            { id: "500-1500", label: "₹500-1500" },
            { id: "1500+", label: "₹1500+" },
          ].map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedBand(b.id)}
              style={{
                background: selectedBand === b.id ? "#1e293b" : "transparent",
                border: `1px solid ${selectedBand === b.id ? "#5B8CFF" : "#334155"}`,
                color: selectedBand === b.id ? "#ffffff" : "#64748b",
                padding: "3px 9px",
                borderRadius: "3px",
                fontSize: "0.68rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "8px",
        }}
      >
        {currentDisplayList.length === 0 ? (
          <div
            style={{
              gridColumn: "1 / -1",
              textAlign: "center",
              padding: "16px",
              color: "#64748b",
              fontSize: "0.75rem",
            }}
          >
            Scanning price bands... No setup meeting criteria yet.
          </div>
        ) : (
          currentDisplayList.map((item) => {
            const isSelected = item.symbol === activeSymbol;
            const isBullish = item.score >= 0;

            return (
              <div
                key={item.token}
                onClick={() =>
                  onSelectStock &&
                  onSelectStock({
                    symbol: item.symbol,
                    token: item.token,
                    exchangeSegment: item.segment,
                  })
                }
                style={{
                  background: isSelected
                    ? "rgba(91, 140, 255, 0.12)"
                    : "#090d16",
                  border: isSelected
                    ? "1px solid #5B8CFF"
                    : "1px solid #1e293b",
                  borderRadius: "6px",
                  padding: "8px 10px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      color: "#f8fafc",
                    }}
                  >
                    {item.symbol}
                  </span>
                  {activeTab === "scalper" ? (
                    <span
                      style={{
                        fontSize: "0.62rem",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        background: item.isTrap
                          ? "rgba(255, 93, 93, 0.2)"
                          : "rgba(47, 217, 138, 0.2)",
                        color: item.isTrap ? "#FF5D5D" : "#2FD98A",
                        fontWeight: 700,
                      }}
                    >
                      {item.isTrap ? "⚠️ TRAP DUMP" : "⚡ IGNITION"}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "0.68rem",
                        fontWeight: 700,
                        color: isBullish ? "#2FD98A" : "#FF5D5D",
                      }}
                    >
                      {isBullish ? "+" : ""}
                      {item.score} pts
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "6px",
                    fontSize: "0.72rem",
                  }}
                >
                  <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>
                    ₹{item.ltp > 0 ? fmt(item.ltp) : "—"}
                  </span>
                  <span style={{ color: "#64748b", fontSize: "0.65rem" }}>
                    {item.currentBand}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
