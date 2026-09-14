// components/AiAnalystPanel.jsx
"use client";
import { useState } from "react";

export default function AiAnalystPanel({ symbol, score, ind, pattern }) {
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState("");

  const fetchAiInsight = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, score, ind, pattern }),
      });
      const data = await res.json();
      if (data.success) setInsight(data.analysis);
    } catch (e) {
      setInsight("Could not fetch AI analysis.");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        marginTop: "12px",
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
        }}
      >
        <span
          style={{ fontSize: "0.78rem", fontWeight: 700, color: "#38bdf8" }}
        >
          🤖 AI INSTITUTIONAL CO-PILOT
        </span>
        <button
          onClick={fetchAiInsight}
          disabled={loading}
          style={{
            background: "#0284c7",
            color: "#fff",
            border: "none",
            padding: "4px 10px",
            borderRadius: "4px",
            fontSize: "0.7rem",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Analyzing..." : "Ask AI Verdict"}
        </button>
      </div>
      {insight && (
        <p
          style={{
            fontSize: "0.74rem",
            color: "#cbd5e1",
            marginTop: "8px",
            borderLeft: "2px solid #38bdf8",
            paddingLeft: "8px",
          }}
        >
          {insight}
        </p>
      )}
    </div>
  );
}
