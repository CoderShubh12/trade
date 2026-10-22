"use client";
// /breakouts - Top 20 breakout-style stocks, Chartink-style "hit counter" on live quote data (read-only, paper research).
import { useEffect, useState } from "react";

const th = { textAlign: "left", padding: "8px 10px", color: "#8b93a7", fontWeight: 600, fontSize: 12, borderBottom: "1px solid #232838" };
const td = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #1b2030" };

export default function Breakouts() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [at, setAt] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/breakouts", { cache: "no-store" });
        const j = await r.json();
        if (!live) return;
        if (!j.success) throw new Error(j.error || "failed");
        setD(j); setErr(""); setAt(new Date().toLocaleTimeString("en-IN"));
      } catch (e) { if (live) setErr(String(e.message || e)); }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);
  const n = d?.conditions?.length || 6;
  return (
    <div style={{ background: "#0d1017", minHeight: "100vh", color: "#e6e9f2", padding: "20px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <a href="/" style={{ color: "#6ea8fe", fontSize: 13 }}>← Terminal</a>
        <h1 style={{ fontSize: 22, margin: "10px 0 4px" }}>Top 20 Breakout Stocks</h1>
        <div style={{ color: "#8b93a7", fontSize: 12, marginBottom: 12 }}>
          Chartink-style counter: each condition met = 1 hit (max {n}). Live quotes, refreshes every 30 s{at ? `, last ${at}` : ""}. A shortlist for research, not a call; the engine still needs its own score.
        </div>
        {err && <div style={{ color: "#ff8a80", marginBottom: 10 }}>Error: {err}</div>}
        {!d && !err && <div style={{ color: "#8b93a7" }}>Loading…</div>}
        {d && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["#", "Stock", "LTP", "Chg %", "Off day high %", "To 52w high %", "Hits", "Conditions met"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {d.top20.length === 0 && <tr><td style={td} colSpan={8}>No stock meets any condition right now.</td></tr>}
                {d.top20.map((x, i) => (
                  <tr key={x.token}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{x.symbol}</td>
                    <td style={td}>{x.ltp.toFixed(2)}</td>
                    <td style={{ ...td, color: x.chgPct >= 0 ? "#4cd08a" : "#ff8a80" }}>{x.chgPct.toFixed(2)}</td>
                    <td style={td}>{x.offDayHighPct.toFixed(2)}</td>
                    <td style={td}>{x.to52wHighPct == null ? "-" : x.to52wHighPct.toFixed(1)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{x.hits}/{n}</td>
                    <td style={{ ...td, color: "#8b93a7", fontSize: 12 }}>{x.met.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
