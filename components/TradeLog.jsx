// components/TradeLog.jsx
// One row per call, so repeated calls are easy to spot.
"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/utils";
import { summarize, PAPER } from "@/lib/paperStats";

const REASONS = {
  TARGET_2_HIT: "Target 2",
  TRAILING_SL_HIT: "Trailing stop",
  STOP_LOSS_HIT: "Stop loss",
  VWAP_BREACH_EXIT: "VWAP exit",
  TIME_DECAY_TIMEOUT: "25-min limit",
  MARKET_CLOSE_SQUAREOFF: "3:15 square-off",
};

function Journal({ refreshKey }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let off = false;
    const load = () => fetch("/api/journal").then((r) => r.json()).then((j) => !off && setRows(j.items || [])).catch(() => {});
    const t = setTimeout(load, 800); // let the newest call reach the server first
    return () => { off = true; clearTimeout(t); };
  }, [refreshKey]);
  if (!rows) return null;
  const S = summarize(rows);
  const days = new Set(rows.map((r) => r.dateStr)).size;
  const rs = (v) => `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
  const enough = S.n >= 100;
  const good = enough && S.pf >= 1.3 && S.expectancy > 0;
  return (
    <div style={{ background: "#070b13", border: "1px solid #1e293b", borderRadius: 6, padding: "8px 10px", fontSize: "0.72rem", color: "#94a3b8" }}>
      <div style={{ color: "#e2e8f0", fontWeight: 800, marginBottom: 4 }}>PAPER JOURNAL · all live days</div>
      {S.n === 0 ? (
        <div>No closed live trades yet. Each live call is saved here automatically (replay is never saved).</div>
      ) : (
        <>
          <div>{S.n} closed trades over {days} day{days > 1 ? "s" : ""} · win rate {S.winPct.toFixed(0)}% · profit factor {S.pf == null ? "—" : S.pf.toFixed(2)}</div>
          <div>
            Net after costs <strong style={{ color: S.net >= 0 ? "#2FD98A" : "#FF5D5D" }}>{rs(S.net)}</strong>
            {" "}(gross {rs(S.gross)}, costs {rs(S.costs)}) · per trade <strong>{rs(S.expectancy)}</strong>
          </div>
          <div style={{ color: good ? "#2FD98A" : "#f59e0b", marginTop: 3 }}>
            {enough ? (good ? "Passes the bar (PF ≥ 1.3, positive per trade) — still paper only." : "Below the bar (PF ≥ 1.3 and positive per trade).") : `Too few trades to judge: ${S.n}/100.`}
          </div>
        </>
      )}
      <div style={{ color: "#64748b", fontSize: "0.65rem", marginTop: 3 }}>
        Sized {PAPER.riskPct}% risk on ₹{PAPER.capital.toLocaleString("en-IN")}, {PAPER.slipPct}% slippage per side, full intraday charges. {" "}
        <a href="/api/journal?format=csv" style={{ color: "#60a5fa" }}>Download CSV</a>
      </div>
    </div>
  );
}

export default function TradeLog({ log = [], isReplay }) {
  const closed = log.filter((t) => t.exitPrice != null);
  const totalR = closed.reduce((s, t) => s + (t.r || 0), 0);
  const wins = closed.filter((t) => (t.r || 0) > 0).length;

  const journalKey = log.map((t) => `${t.id}${t.exitPrice ?? ""}`).join("|");
  if (log.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!isReplay && <Journal refreshKey="empty" />}
        <div style={{ color: "#64748b", fontSize: "0.78rem", padding: "8px 2px" }}>
        No calls yet {isReplay ? "in this replay" : "today"}. Each call and its exit will be listed here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!isReplay && <Journal refreshKey={journalKey} />}
      <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
        {log.length} call{log.length > 1 ? "s" : ""}
        {closed.length > 0 && (
          <>
            {" "}· {wins}/{closed.length} winners · total{" "}
            <strong style={{ color: totalR >= 0 ? "#2FD98A" : "#FF5D5D" }}>
              {totalR >= 0 ? "+" : "−"}
              {Math.abs(totalR).toFixed(2)}R
            </strong>
          </>
        )}
        <div style={{ color: "#64748b", fontSize: "0.65rem" }}>
          Before charges and slippage. A handful of trades proves nothing.
        </div>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {[...log].reverse().map((t) => {
          const open = t.exitPrice == null;
          const col = t.side === "BUY" ? "#2FD98A" : "#FF5D5D";
          return (
            <div
              key={t.id}
              style={{
                background: "#080d17",
                borderLeft: `3px solid ${col}`,
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: "0.74rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  <strong style={{ color: col }}>{t.side}</strong>{" "}
                  <strong style={{ color: "#f8fafc" }}>{t.symbol}</strong>
                </span>
                <span style={{ color: "#64748b" }}>{t.entryClock}</span>
              </div>
              <div style={{ fontFamily: "monospace", color: "#cbd5e1" }}>
                ₹{fmt(t.entry)} → {open ? "open" : `₹${fmt(t.exitPrice)} (${t.exitClock})`}
              </div>
              <div style={{ color: "#94a3b8" }}>
                {open ? (
                  "Running"
                ) : (
                  <>
                    {REASONS[t.reason] || t.reason} ·{" "}
                    <strong style={{ color: t.r >= 0 ? "#2FD98A" : "#FF5D5D" }}>
                      {t.r >= 0 ? "+" : "−"}
                      {Math.abs(t.r).toFixed(2)}R
                    </strong>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
