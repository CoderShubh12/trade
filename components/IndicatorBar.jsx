"use client";

export default function IndicatorBar({ name, score = 0, detail = "—" }) {
  const safeScore = typeof score === "number" && !isNaN(score) ? score : 0;
  const isPositive = safeScore >= 0;

  // Bar width calculation based on maximum typical indicator weight (~25 pts)
  const barWidth = Math.min(100, (Math.abs(safeScore) / 25) * 100);
  const color = isPositive ? "#2FD98A" : "#FF5D5D";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "10px 12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "6px",
        marginBottom: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.78rem",
        }}
      >
        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>{name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>
            {detail}
          </span>
          <span
            style={{
              color,
              fontWeight: 700,
              minWidth: "45px",
              textAlign: "right",
            }}
          >
            {isPositive ? `+${safeScore}` : safeScore} pts
          </span>
        </div>
      </div>

      {/* Visual Score Bar Track */}
      <div
        style={{
          width: "100%",
          height: "5px",
          background: "#1e293b",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${barWidth}%`,
            height: "100%",
            backgroundColor: color,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
