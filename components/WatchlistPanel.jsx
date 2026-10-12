// components/WatchlistPanel.jsx
// Watchlist saved on the server (data/watchlist.json).
"use client";

import { fmt } from "@/lib/utils";

export default function WatchlistPanel({
  items = [],
  loading,
  error,
  activeToken,
  canAddCurrent,
  currentSymbol,
  onAddCurrent,
  onSelect,
  onRemove,
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={onAddCurrent}
        disabled={!canAddCurrent}
        style={{
          background: canAddCurrent ? "rgba(251,191,36,0.12)" : "transparent",
          color: canAddCurrent ? "#fbbf24" : "#64748b",
          border: `1px solid ${canAddCurrent ? "#fbbf24" : "#334155"}`,
          borderRadius: 6,
          padding: "7px 10px",
          fontWeight: 800,
          fontSize: "0.76rem",
          cursor: canAddCurrent ? "pointer" : "default",
        }}
      >
        {canAddCurrent ? `☆ Add ${currentSymbol} to watchlist` : `★ ${currentSymbol} is in watchlist`}
      </button>

      {error && <div style={{ color: "#f87171", fontSize: "0.74rem" }}>{error}</div>}
      {loading && items.length === 0 && (
        <div style={{ color: "#64748b", fontSize: "0.76rem" }}>Loading…</div>
      )}
      {!loading && items.length === 0 && !error && (
        <div style={{ color: "#64748b", fontSize: "0.78rem" }}>
          Nothing saved yet. Search any stock and add it, or add a call when the tool gives one.
        </div>
      )}

      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((w) => {
          const col = w.side === "BUY" ? "#2FD98A" : w.side === "SELL" ? "#FF5D5D" : "#5B8CFF";
          return (
            <div
              key={w.token}
              onClick={() => onSelect(w)}
              style={{
                background: w.token === activeToken ? "rgba(91,140,255,0.12)" : "#080d17",
                border: `1px solid ${w.token === activeToken ? "#5B8CFF" : "#1e293b"}`,
                borderLeft: `3px solid ${col}`,
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: "0.74rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  <strong style={{ color: "#f8fafc" }}>{w.symbol}</strong>{" "}
                  <span style={{ color: col, fontWeight: 800 }}>
                    {w.source === "CALL" ? `${w.side} call` : "watching"}
                  </span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(w);
                  }}
                  title="Remove"
                  style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
              {w.source === "CALL" && w.entry && (
                <div style={{ fontFamily: "monospace", color: "#94a3b8" }}>
                  Entry ₹{fmt(w.entry)} · SL ₹{fmt(w.stopLoss)} · T1 ₹{fmt(w.target1)}
                </div>
              )}
              <div style={{ color: "#64748b", fontSize: "0.65rem" }}>
                added {new Date(w.addedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
