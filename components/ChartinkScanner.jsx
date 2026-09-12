// components/ChartinkScanner.jsx
"use client";

import { useState } from "react";
import { SCANNER_STRATEGIES } from "@/lib/scannerEngine";
import { fmt } from "@/lib/utils";

export default function ChartinkScanner({ onSelectStock }) {
  const [selectedStrategy, setSelectedStrategy] =
    useState("BULLISH_VWAP_CROSS");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [lastScanTime, setLastScanTime] = useState(null);

  const handleRunScan = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId: selectedStrategy }),
      });
      const data = await res.json();
      if (data.success) {
        setResults(data.results || []);
        setLastScanTime(new Date().toLocaleTimeString("en-IN"));
      }
    } catch (err) {
      console.error("Scanner Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        margin: "12px 0",
        padding: "12px 16px",
        background: "#080d1a",
        border: "1px solid #1e293b",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{ fontSize: "0.85rem", fontWeight: 800, color: "#38bdf8" }}
          >
            📊 INTRADAY SCANNER (CHARTINK ENGINE)
          </span>
          {lastScanTime && (
            <span style={{ fontSize: "0.68rem", color: "#64748b" }}>
              Last scan: {lastScanTime}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            style={{
              background: "#0f172a",
              border: "1px solid #334155",
              color: "#f8fafc",
              padding: "5px 10px",
              borderRadius: "4px",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            {Object.values(SCANNER_STRATEGIES).map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>

          <button
            onClick={handleRunScan}
            disabled={loading}
            style={{
              background: loading ? "#334155" : "#0284c7",
              color: "#fff",
              border: "none",
              padding: "5px 14px",
              borderRadius: "4px",
              fontSize: "0.75rem",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "SCANNING POOL..." : "⚡ RUN SCAN"}
          </button>
        </div>
      </div>

      {/* Results List */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          minHeight: "34px",
          alignItems: "center",
        }}
      >
        {results.length === 0 && !loading && (
          <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
            कंडीशन मैच करने वाले स्टॉक्स देखने के लिए 'RUN SCAN' पर क्लिक करें।
          </span>
        )}

        {results.map((st) => (
          <button
            key={st.token}
            onClick={() => onSelectStock(st)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              background: "rgba(56, 189, 248, 0.1)",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              borderRadius: "4px",
              color: "#38bdf8",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: 600,
            }}
          >
            <span>{st.symbol}</span>
            <span
              style={{
                color: "#cbd5e1",
                fontSize: "0.7rem",
                fontFamily: "monospace",
              }}
            >
              ₹{fmt(st.price)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
