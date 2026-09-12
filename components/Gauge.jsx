// components/Gauge.jsx
"use client";

import { useMemo, useState, useEffect } from "react";

export default function Gauge({ score = 0 }) {
  // क्लैम्प स्कोर: -100 से +100
  const clampedScore = Math.max(-100, Math.min(100, score || 0));

  // स्कोर को एंगल में बदलें:
  // -100 = -90deg (Full Red / Left)
  //    0 =   0deg (Neutral / Center Top)
  // +100 = +90deg (Full Green / Right)
  const needleAngle = (clampedScore / 100) * 90;

  // लाइव हिस्ट्री स्पार्कलाइन (पिछले 20 टिक्स का ट्रेंड)
  const [history, setHistory] = useState([clampedScore]);

  useEffect(() => {
    setHistory((prev) => {
      const next = [...prev, clampedScore];
      return next.length > 20 ? next.slice(-20) : next;
    });
  }, [clampedScore]);

  // स्टेटस लेबल और थीम कलर
  const { label, color, glowColor } = useMemo(() => {
    if (clampedScore >= 65) {
      return {
        label: "STRONG BULLISH",
        color: "#2FD98A",
        glowColor: "rgba(47, 217, 138, 0.4)",
      };
    }
    if (clampedScore > 15) {
      return {
        label: "MILD BULLISH",
        color: "#4ade80",
        glowColor: "rgba(74, 222, 128, 0.3)",
      };
    }
    if (clampedScore <= -65) {
      return {
        label: "STRONG BEARISH",
        color: "#FF5D5D",
        glowColor: "rgba(255, 93, 93, 0.4)",
      };
    }
    if (clampedScore < -15) {
      return {
        label: "MILD BEARISH",
        color: "#f87171",
        glowColor: "rgba(248, 113, 113, 0.3)",
      };
    }
    return {
      label: "NEUTRAL / CHOP",
      color: "#94a3b8",
      glowColor: "rgba(148, 163, 184, 0.2)",
    };
  }, [clampedScore]);

  // स्पार्कलाइन SVG पाथ जनरेटर
  const sparklinePath = useMemo(() => {
    if (history.length < 2) return "";
    const w = 180;
    const h = 32;
    const step = w / (history.length - 1);

    return history
      .map((val, idx) => {
        const x = idx * step;
        // val -100 to 100 -> Y 30 to 2
        const y = h / 2 - (val / 100) * (h / 2 - 3);
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [history]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        padding: "10px 0",
      }}
    >
      {/* 🏎️ Speedometer SVG Dial */}
      <div
        style={{
          position: "relative",
          width: "220px",
          height: "125px",
          overflow: "hidden",
        }}
      >
        <svg
          viewBox="0 0 200 115"
          style={{ width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            {/* डायल बैकग्राउंड ग्रेडिएंट: Red -> Orange -> Slate -> Teal -> Green */}
            <linearGradient id="speedoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ff4d4d" />
              <stop offset="25%" stopColor="#fb923c" />
              <stop offset="50%" stopColor="#475569" />
              <stop offset="75%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#2fd98a" />
            </linearGradient>

            {/* नीडल का नियॉन ग्लो */}
            <filter
              id="needleGlow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="3"
                floodColor={color}
                floodOpacity="0.8"
              />
            </filter>
          </defs>

          {/* बैकग्राउंड डार्क ट्रैक */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="#1e293b"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* कलर्ड स्पीडोमीटर आर्क */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#speedoGrad)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray="251.3"
            strokeDashoffset="0"
          />

          {/* डायल टिक्स मार्कर्स */}
          {/* -100 Tick */}
          <line
            x1="22"
            y1="100"
            x2="30"
            y2="100"
            stroke="#ff4d4d"
            strokeWidth="2"
          />
          {/* -65 Threshold */}
          <line
            x1="43"
            y1="58"
            x2="50"
            y2="62"
            stroke="#ff7070"
            strokeWidth="2"
          />
          {/* 0 Center Neutral */}
          <line
            x1="100"
            y1="20"
            x2="100"
            y2="28"
            stroke="#94a3b8"
            strokeWidth="2"
          />
          {/* +65 Threshold */}
          <line
            x1="157"
            y1="58"
            x2="150"
            y2="62"
            stroke="#4ade80"
            strokeWidth="2"
          />
          {/* +100 Tick */}
          <line
            x1="178"
            y1="100"
            x2="170"
            y2="100"
            stroke="#2fd98a"
            strokeWidth="2"
          />

          {/* 🎯 स्पीडोमीटर नीडल (Smooth CSS Pivot Rotation) */}
          <g
            style={{
              transform: `rotate(${needleAngle}deg)`,
              transformOrigin: "100px 100px",
              transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            {/* नीडल की पतली तीखी सुई */}
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="28"
              stroke={color}
              strokeWidth="3.5"
              strokeLinecap="round"
              filter="url(#needleGlow)"
            />
            {/* सेंटर पाइवोट पिन */}
            <circle
              cx="100"
              cy="100"
              r="7"
              fill="#0b0f19"
              stroke={color}
              strokeWidth="3"
            />
            <circle cx="100" cy="100" r="3" fill="#ffffff" />
          </g>
        </svg>

        {/* मिनिमल डायल रेंज लेबल्स */}
        <span
          style={{
            position: "absolute",
            bottom: "0",
            left: "10px",
            fontSize: "0.62rem",
            color: "#ff5d5d",
            fontWeight: 800,
          }}
        >
          -100
        </span>
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "0.6rem",
            color: "#64748b",
            fontWeight: 700,
          }}
        >
          0 (NEUTRAL)
        </span>
        <span
          style={{
            position: "absolute",
            bottom: "0",
            right: "10px",
            fontSize: "0.62rem",
            color: "#2fd98a",
            fontWeight: 800,
          }}
        >
          +100
        </span>
      </div>

      {/* ⚡ डिजिटल स्पीडोमीटर रीडआउट */}
      <div style={{ textAlign: "center", marginTop: "2px" }}>
        <div
          style={{
            fontSize: "1.4rem",
            fontWeight: 900,
            fontFamily: "monospace",
            color: color,
            textShadow: `0 0 16px ${glowColor}`,
            letterSpacing: "0.02em",
          }}
        >
          {clampedScore > 0 ? `+${clampedScore}` : clampedScore}
          <span
            style={{ fontSize: "0.75rem", color: "#64748b", marginLeft: "4px" }}
          >
            PTS
          </span>
        </div>

        <div
          style={{
            fontSize: "0.74rem",
            fontWeight: 800,
            color: color,
            letterSpacing: "0.08em",
            marginTop: "-2px",
          }}
        >
          {label}
        </div>
      </div>

      {/* 📈 लाइव मोमेंटम वेव स्पार्कलाइन (Needle History Wave) */}
      <div
        style={{
          width: "100%",
          maxWidth: "200px",
          marginTop: "10px",
          background: "rgba(15, 23, 42, 0.4)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          borderRadius: "6px",
          padding: "6px 8px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.62rem",
            color: "#64748b",
            fontWeight: 600,
          }}
        >
          <span>MOMENTUM PULSE</span>
          <span style={{ color: color }}>LIVE</span>
        </div>

        <svg
          width="100%"
          height="28"
          viewBox="0 0 180 32"
          style={{ overflow: "visible" }}
        >
          {/* Zero Line */}
          <line
            x1="0"
            y1="16"
            x2="180"
            y2="16"
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="2 2"
          />

          {/* Pulse Curve */}
          {sparklinePath && (
            <path
              d={sparklinePath}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: "stroke 0.3s ease" }}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
