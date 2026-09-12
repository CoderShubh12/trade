// components/SignalAlertModal.jsx
"use client";

import { useEffect } from "react";
import { fmt } from "@/lib/utils";

export default function SignalAlertModal({ alert, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!alert) return null;

  const isExit = alert.type === "EXIT_NOW";
  const isTarget = alert.type === "TARGET_HIT";
  const isSl = alert.type === "SL_HIT";
  const isBuy = alert.type === "BUY";
  const isSell = alert.type === "SELL";

  const themeColor = isExit || isSl || isSell ? "#FF5D5D" : "#2FD98A";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(3, 7, 18, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#0b101b",
          border: `2px solid ${themeColor}`,
          borderRadius: "10px",
          boxShadow: `0 0 30px ${themeColor}40`,
          overflow: "hidden",
          animation: "modalFadeIn 0.25s ease-out",
        }}
      >
        <div
          style={{
            background: isExit
              ? "rgba(255, 93, 93, 0.25)"
              : isTarget
                ? "rgba(47, 217, 138, 0.25)"
                : `${themeColor}15`,
            borderBottom: `1px solid ${themeColor}40`,
            padding: "12px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: themeColor,
                display: "inline-block",
              }}
            />
            <h3
              style={{
                margin: 0,
                fontSize: "0.95rem",
                fontWeight: 800,
                color: themeColor,
                letterSpacing: "0.04em",
              }}
            >
              {isExit && "🚨 EMERGENCY EXIT // CUT POSITION NOW"}
              {isTarget && "🎯 TARGET 1 ACHIEVED"}
              {isSl && "🛑 STOP LOSS HIT"}
              {isBuy && "⚡ 5M INSTITUTIONAL BUY CALL"}
              {isSell && "⚡ 5M INSTITUTIONAL SELL CALL"}
            </h3>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: "1.2rem",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: "18px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "14px",
              paddingBottom: "12px",
              borderBottom: "1px solid #1e293b",
            }}
          >
            <div>
              <span
                style={{
                  fontSize: "1.3rem",
                  fontWeight: 800,
                  color: "#f8fafc",
                }}
              >
                {alert.symbol}
              </span>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "#64748b",
                  marginLeft: "8px",
                }}
              >
                5M TIME-WINDOW
              </span>
            </div>

            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                SPOT LTP:{" "}
              </span>
              <span
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 800,
                  color: themeColor,
                  fontFamily: "monospace",
                }}
              >
                ₹{fmt(alert.price || alert.exitPrice)}
              </span>
            </div>
          </div>

          {isExit && (
            <div
              style={{
                background: "rgba(255, 93, 93, 0.12)",
                border: "1px solid rgba(255, 93, 93, 0.3)",
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "14px",
                color: "#fca5a5",
                fontSize: "0.82rem",
                lineHeight: "1.4",
              }}
            >
              <strong>कारण:</strong> {alert.reason} (VWAP: ₹
              {fmt(alert.vwapPrice)})
              <br />
              प्राइस ने Session VWAP को तोड़ दिया है। ट्रेंड का मोमेंटम समाप्त
              हो चुका है। बड़े नुकसान से बचने के लिए अपनी पोजीशन को तुरंत काटें।
            </div>
          )}

          {(isTarget || isSl) && (
            <div
              style={{
                background: isTarget
                  ? "rgba(47, 217, 138, 0.1)"
                  : "rgba(255, 93, 93, 0.1)",
                border: `1px solid ${themeColor}30`,
                borderRadius: "6px",
                padding: "12px",
                marginBottom: "14px",
                color: "#f8fafc",
                fontSize: "0.82rem",
              }}
            >
              {alert.message}
            </div>
          )}

          {(isBuy || isSell) && alert.levels && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  background: "#080d17",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: "0.68rem", color: "#64748b" }}>
                  STOP LOSS
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: "#FF5D5D",
                    fontFamily: "monospace",
                  }}
                >
                  ₹{fmt(alert.levels.stopLoss)}
                </div>
              </div>

              <div
                style={{
                  background: "#080d17",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: "0.68rem", color: "#64748b" }}>
                  TARGET 1 (1:1.5)
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: "#2FD98A",
                    fontFamily: "monospace",
                  }}
                >
                  ₹{fmt(alert.levels.target1)}
                </div>
              </div>

              <div
                style={{
                  background: "#080d17",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #1e293b",
                }}
              >
                <div style={{ fontSize: "0.68rem", color: "#64748b" }}>
                  TARGET 2 (1:2.5)
                </div>
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: "#2FD98A",
                    fontFamily: "monospace",
                  }}
                >
                  ₹{fmt(alert.levels.target2)}
                </div>
              </div>
            </div>
          )}

          <div
            style={{
              background: "#070b13",
              border: "1px solid #1e293b",
              borderRadius: "6px",
              padding: "10px 12px",
              fontSize: "0.72rem",
              color: "#94a3b8",
            }}
          >
            <div
              style={{
                color: "#e2e8f0",
                fontWeight: 700,
                marginBottom: "6px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <span>📋</span> MANDATORY TRADING RULES (USER DISCIPLINE)
            </div>
            <ul style={{ margin: 0, paddingLeft: "16px", lineHeight: "1.6" }}>
              <li>
                <strong>Trade Window:</strong> 15 से 25 मिनट (3–5 कैंडल्स)।
              </li>
              <li>
                <strong>Stagnation Exit:</strong> 20 मिनट तक मूव न आने पर कॉस्ट
                पर निकलें।
              </li>
              <li>
                <strong>Immediate Cut:</strong> 5M कैंडल Session VWAP के विपरीत
                क्लोज होते ही एग्जिट।
              </li>
              <li style={{ color: "#f59e0b" }}>
                <strong>Self-Analysis:</strong> यह केवल एल्गो मैट्रिक्स सेटअप
                है। रिस्क और साइजिंग आपकी अपनी जिम्मेदारी है।
              </li>
            </ul>
          </div>
        </div>

        <div
          style={{
            padding: "12px 18px",
            background: "#080c16",
            borderTop: "1px solid #1e293b",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: themeColor,
              color: "#030712",
              border: "none",
              padding: "7px 18px",
              borderRadius: "5px",
              fontSize: "0.75rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {isExit ? "ACKNOWLEDGED (CUT NOW)" : "UNDERSTOOD & PROCEED"}
          </button>
        </div>
      </div>
    </div>
  );
}
