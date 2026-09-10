"use client";

import { useState, useEffect } from "react";

export default function AiRecommendation({ symbol, ind, scores, atr }) {
  const [insight, setInsight] = useState("");
  const [loading, setLoading] = useState(false);

  async function getAiVerdict() {
    if (!ind?.latest?.price) return;
    setLoading(true);

    try {
      const res = await fetch("/api/ai-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          price: ind.latest.price,
          vwap: ind.latest.vwap,
          rsi: ind.latest.rsi ? ind.latest.rsi.toFixed(1) : 50,
          orbState: ind.orbState,
          cprState: ind.cprState,
          atr: atr ? atr.toFixed(2) : "1.00",
          biasScore:
            scores?.technicalScore !== undefined
              ? scores.technicalScore.toFixed(1)
              : "0.0",
          trend:
            (scores?.trendScore ?? 0) >= 0
              ? "Bullish (EMA 9 > 21)"
              : "Bearish (EMA 9 < 21)",
        }),
      });

      const json = await res.json();
      setInsight(json.success ? json.insight : "AI Note: " + json.error);
    } catch (e) {
      setInsight("AI service bridge currently unreachable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ind?.latest?.price) {
      getAiVerdict();
    }
  }, [symbol]);

  return (
    <section
      className="card ai-card"
      style={{
        marginTop: "16px",
        padding: "20px 24px",
        background: "#0d131f",
        border: "1px solid #1a2336",
        borderRadius: "10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1rem", color: "#5B8CFF" }}>✦</span>
          <h2
            style={{
              fontSize: "0.92rem",
              letterSpacing: "0.06em",
              color: "#5B8CFF",
              margin: 0,
              fontWeight: 700,
            }}
          >
            INSTITUTIONAL AI THESIS // GEMINI QUANT ENGINE
          </h2>
          <span
            style={{
              fontSize: "0.68rem",
              background: "rgba(91, 140, 255, 0.12)",
              color: "#5B8CFF",
              padding: "2px 8px",
              borderRadius: "4px",
              fontWeight: 600,
            }}
          >
            {symbol}
          </span>
        </div>

        <button
          onClick={getAiVerdict}
          disabled={loading}
          style={{
            background: loading ? "transparent" : "rgba(91, 140, 255, 0.1)",
            border: "1px solid #293854",
            color: loading ? "#555d6e" : "#a5b4fc",
            fontSize: "0.78rem",
            padding: "5px 14px",
            borderRadius: "6px",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
            transition: "all 0.2s",
          }}
        >
          {loading ? "Crunching Telemetry..." : "↻ Deep Re-Analyze"}
        </button>
      </div>

      <div
        style={{
          fontSize: "0.88rem",
          lineHeight: "1.8",
          color: "#e2e8f0",
          whiteSpace: "pre-wrap",
          background: "rgba(15, 23, 42, 0.65)",
          padding: "16px 20px",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          wordBreak: "break-word",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {insight ||
          'Click "Deep Re-Analyze" to generate institutional trading thesis.'}
      </div>
    </section>
  );
}
