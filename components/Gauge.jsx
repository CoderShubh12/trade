"use client";

function labelFor(score) {
  if (score >= 65) return "STRONG BUY";
  if (score >= 20) return "MODERATE BUY";
  if (score <= -65) return "STRONG SELL";
  if (score <= -20) return "MODERATE SELL";
  return "NEUTRAL";
}

function colorFor(score) {
  if (score >= 65) return "#2FD98A";
  if (score >= 20) return "#4ADE80";
  if (score <= -65) return "#FF5D5D";
  if (score <= -20) return "#F87171";
  return "#94A3B8";
}

export default function Gauge({ score = 0 }) {
  const safeScore = typeof score === "number" && !isNaN(score) ? score : 0;
  const clampedScore = Math.max(-100, Math.min(100, safeScore));

  // -100 to +100 mapped to -90 to +90 degrees
  const angle = (clampedScore / 100) * 90;
  const label = labelFor(clampedScore);
  const color = colorFor(clampedScore);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 0",
        width: "100%",
      }}
    >
      <div style={{ position: "relative", width: "220px", height: "115px" }}>
        <svg
          viewBox="0 0 200 110"
          width="100%"
          height="100%"
          style={{ overflow: "visible" }}
        >
          <defs>
            <linearGradient
              id="gaugeGradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor="#FF5D5D" />
              <stop offset="30%" stopColor="#F87171" />
              <stop offset="50%" stopColor="#94A3B8" />
              <stop offset="70%" stopColor="#4ADE80" />
              <stop offset="100%" stopColor="#2FD98A" />
            </linearGradient>
          </defs>

          {/* Background Arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="#1a2333"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Colored Metric Arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="14"
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Needle Pointer */}
          <g transform={`rotate(${angle}, 100, 100)`}>
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="28"
              stroke="#ffffff"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            <circle cx="100" cy="100" r="6" fill="#ffffff" />
          </g>
        </svg>
      </div>

      {/* Numerical & Label Readouts */}
      <div style={{ textAlign: "center", marginTop: "4px" }}>
        <div
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            color,
            letterSpacing: "0.03em",
          }}
        >
          {clampedScore > 0 ? `+${clampedScore}` : clampedScore}
        </div>
        <div
          style={{
            fontSize: "0.78rem",
            fontWeight: 700,
            color,
            marginTop: "2px",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
