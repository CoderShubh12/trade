"use client";
// Top-20 breakout (Chartink-style hit counter) + "pick bot" that blinks on stocks meeting >=5 of 6 conditions and says WHY on screen.
// Live quotes only, refresh 30 s. Research aid: a pick is a candidate, not a call. Out-of-sample tests showed no tradable edge.
import { useEffect, useState } from "react";

const th = { textAlign: "left", padding: "6px 8px", color: "#8b93a7", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #1e293b" };
const td = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #131a2b" };

function why(x) {
  const bits = [];
  if (x.chgPct > 0) bits.push(`up ${x.chgPct.toFixed(2)}% on the day`);
  if (x.offDayHighPct <= 0.25) bits.push(`trading ${x.offDayHighPct.toFixed(2)}% below the day high`);
  if (x.rangePos != null && x.rangePos >= 0.8) bits.push(`in the top ${Math.round((1 - x.rangePos) * 100) || 1}% of today's range`);
  if (x.open > 0 && x.ltp > x.open) bits.push("above today's open");
  if (x.prevClose > 0 && x.open > x.prevClose * 1.002) bits.push("gapped up at open");
  if (x.to52wHighPct != null && x.to52wHighPct <= 5) bits.push(`${x.to52wHighPct.toFixed(1)}% from its 52-week high`);
  return bits.join("; ");
}

export default function BreakoutPanel({ onPick }) {
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
  const picks = d?.picks || [];
  return (
    <section style={{ margin: "12px 0", padding: "12px 16px", background: "#080d1a", border: "1px solid #1e293b", borderRadius: 8 }}>
      <style>{`@keyframes bkBlink{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.0);background:#1a1606}50%{box-shadow:0 0 14px 3px rgba(250,204,21,.7);background:#2b2308}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#38bdf8" }}>🔥 TOP 20 BREAKOUT STOCKS (CHARTINK-STYLE)</span>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>live quotes, every 30 s{at ? `, last ${at}` : ""}</span>
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>Error: {err}</div>}
      {d && picks.length === 0 && <div style={{ fontSize: 12, color: "#8b93a7", marginBottom: 8 }}>🤖 Pick bot: no stock meets {5}+ of {n} conditions right now, so nothing to pick.</div>}
      {picks.map((x) => (
        <div key={x.token} style={{ animation: "bkBlink 1.2s infinite", border: "1px solid #facc15", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 800, color: "#facc15" }}>🤖 PICK THIS: {x.symbol} <span style={{ color: "#e2e8f0", fontWeight: 600 }}>@ {x.ltp.toFixed(2)} ({x.hits}/{n} hits)</span></span>
            {onPick && <button onClick={() => onPick(x)} style={{ background: "#facc15", color: "#111", border: 0, borderRadius: 4, padding: "3px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Open chart</button>}
          </div>
          <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 4 }}><b>Why:</b> {why(x)}.</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Take it only if you also want the trade: this is a screen candidate, not a call. Past tests showed breakouts often fade, so use your own stop.</div>
        </div>
      ))}
      {d && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead><tr>{["#", "Stock", "LTP", "Chg %", "Off high %", "To 52w %", "Hits", "Conditions met"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {d.top20.length === 0 && <tr><td style={td} colSpan={8}>No stock meets any condition right now.</td></tr>}
              {d.top20.map((x, i) => (
                <tr key={x.token}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{x.symbol}{x.hits >= 5 ? " 🔥" : ""}</td>
                  <td style={td}>{x.ltp.toFixed(2)}</td>
                  <td style={{ ...td, color: x.chgPct >= 0 ? "#4cd08a" : "#ff8a80" }}>{x.chgPct.toFixed(2)}</td>
                  <td style={td}>{x.offDayHighPct.toFixed(2)}</td>
                  <td style={td}>{x.to52wHighPct == null ? "-" : x.to52wHighPct.toFixed(1)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{x.hits}/{n}</td>
                  <td style={{ ...td, color: "#8b93a7", fontSize: 11 }}>{x.met.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
