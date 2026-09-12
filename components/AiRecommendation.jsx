// components/AiRecommendation.jsx
"use client";

import { useState, useEffect } from "react";
import { fmt } from "@/lib/utils";

export default function AiRecommendation({ symbol, ind, scores, atr }) {
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchAiThesis = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, ind, scores, atr }),
      });
      const data = await res.json();
      if (data.success) {
        setAiAnalysis(data.thesis || "No structural insights generated.");
      } else {
        setAiAnalysis("AI quantitative stream unavailable for this tick.");
      }
    } catch (err) {
      setAiAnalysis(
        "Failed to connect to Gemini institutional quant pipeline.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (symbol) {
      fetchAiThesis();
    }
  }, [symbol]);

  return (
    <section className="card ai-card" style={{ marginTop: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          borderBottom: "1px solid rgba(91, 140, 255, 0.2)",
          paddingBottom: "10px",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "0.9rem" }}>✨</span>
          <h2
            className="card-title"
            style={{
              margin: 0,
              color: "#93c5fd",
              letterSpacing: "0.06em",
              fontSize: "0.8rem",
            }}
          >
            INSTITUTIONAL AI THESIS // GEMINI QUANT ENGINE
          </h2>
          <span
            style={{
              fontSize: "0.68rem",
              background: "rgba(91, 140, 255, 0.15)",
              color: "#60a5fa",
              padding: "2px 6px",
              borderRadius: "4px",
              fontWeight: 700,
            }}
          >
            {symbol}
          </span>
        </div>

        <button
          onClick={fetchAiThesis}
          disabled={loading}
          className="refresh-btn"
          style={{ cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "ANALYZING..." : "↻ Deep Re-Analyze"}
        </button>
      </div>

      <div className="ai-content">
        {loading ? (
          <div
            style={{
              color: "#7b8395",
              fontSize: "0.8rem",
              fontStyle: "italic",
              padding: "8px 0",
            }}
          >
            Synthesizing 7-layer institutional order flow, CPR position, and
            volume profile...
          </div>
        ) : (
          <div
            className="ai-text"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowWrap: "break-word",
              lineHeight: "1.6",
              fontSize: "0.82rem",
              color: "#e2e8f0",
            }}
          >
            {aiAnalysis ||
              "Awaiting momentum parameters to compile quantitative thesis."}
          </div>
        )}
      </div>
    </section>
  );
}
