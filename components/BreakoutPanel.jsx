"use client";
// Top-20 breakout (Chartink-style hit counter) + "pick bot" that blinks on stocks meeting >=5 of 6 conditions and says WHY on screen.
// Live quotes only, refresh 30 s. Research aid: a pick is a candidate, not a call. Out-of-sample tests showed no tradable edge.
import { useEffect, useState } from "react";

const th = { textAlign: "left", padding: "6px 8px", color: "#8b93a7", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #1e293b" };
const td = { padding: "6px 8px", fontSize: 12, borderBottom: "1px solid #131a2b" };

function whyDown(x) {
  const bits = [];
  if (x.chgPct < 0) bits.push(`down ${Math.abs(x.chgPct).toFixed(2)}% on the day`);
  if (x.offDayLowPct != null && x.offDayLowPct <= 0.25) bits.push(`trading ${x.offDayLowPct.toFixed(2)}% above the day low`);
  if (x.rangePos != null && x.rangePos <= 0.2) bits.push("in the bottom 20% of today's range");
  if (x.open > 0 && x.ltp < x.open) bits.push("below today's open");
  if (x.prevClose > 0 && x.open < x.prevClose * 0.998) bits.push("gapped down at open");
  if (x.chgPct < -1) bits.push("weak vs previous close");
  return bits.join("; ");
}
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

function BotBox() {
  const [b, setB] = useState(null);
  useEffect(() => {
    let live = true;
    const load = async () => { try { const j = await (await fetch("/api/research-bot", { cache: "no-store" })).json(); if (live && j.success) setB(j); } catch {} };
    load(); const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);
  if (!b) return null;
  const td2 = { padding: "3px 6px", fontSize: 11, borderBottom: "1px solid #131a2b" };
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
      <div style={{ fontSize: 12 }}><b style={{ color: "#38bdf8" }}>🤖 15-MIN RESEARCH BOT (paper only)</b> · today {b.total} trades ({b.open} open, {b.closed} closed, {b.wins} wins) · net {b.netR}R ≈ ₹{b.netRs} after est. costs{b.lastError ? <span style={{ color: "#ff8a80" }}> · error: {b.lastError}</span> : null}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 4px" }}>Every 15 min (09:30-14:45) it opens up to 3 top candidates, exits at SL / T1 / 15:15 on 60-s quotes. A data collector, not a proven strategy.</div>
      {b.trades.length > 0 && (
        <div style={{ maxHeight: 180, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Time", "Stock", "Side", "Entry", "SL", "T1", "Status", "Exit", "Net R"].map((h) => <th key={h} style={{ ...th, fontSize: 10 }}>{h}</th>)}</tr></thead>
            <tbody>{b.trades.map((t) => (
              <tr key={t.id}><td style={td2}>{t.entryClock}</td><td style={{ ...td2, fontWeight: 700 }}>{t.symbol}</td><td style={{ ...td2, color: t.side === "BUY" ? "#4cd08a" : "#ff8a80" }}>{t.side}</td><td style={td2}>{t.entry}</td><td style={td2}>{t.stopLoss}</td><td style={td2}>{t.target1}</td><td style={td2}>{t.status === "OPEN" ? "OPEN" : t.reason}</td><td style={td2}>{t.exit ?? "-"}</td><td style={{ ...td2, color: t.r > 0 ? "#4cd08a" : t.r < 0 ? "#ff8a80" : "#e2e8f0" }}>{t.r ?? "-"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResearchBox() {
  const [cap, setCap] = useState(100000), [risk, setRisk] = useState(0.5), [r, setR] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const run = async () => {
    setBusy(true); setErr("");
    try { const j = await (await fetch(`/api/research?capital=${cap}&riskPct=${risk}`, { cache: "no-store" })).json(); if (!j.success) throw new Error(j.error || "failed"); setR(j); } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  };
  const inp = { width: 90, background: "#0d1424", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "2px 6px", fontSize: 12 };
  return (
    <div style={{ border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
        <b style={{ color: "#a78bfa" }}>📋 SESSION RESEARCH REPORT</b>
        <label>Capital ₹ <input style={inp} type="number" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
        <label>Risk/trade % <input style={{ ...inp, width: 60 }} type="number" step="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} /></label>
        <button onClick={run} disabled={busy} style={{ background: "#7c3aed", color: "#fff", border: 0, borderRadius: 4, padding: "3px 10px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Running…" : "Generate"}</button>
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12, marginTop: 6 }}>Error: {err}</div>}
      {r && (
        <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          <div><b>Data:</b> {r.dataQuality} · {new Date(r.dataAt).toLocaleTimeString("en-IN")}</div>
          <div><b>Market:</b> {r.market.trend}{r.market.nifty ? ` · Nifty ${r.market.nifty.ltp} (${r.market.nifty.chgPct}%)` : ""}{r.market.bankNifty ? ` · Bank Nifty ${r.market.bankNifty.ltp} (${r.market.bankNifty.chgPct}%)` : ""}</div>
          <div style={{ color: "#94a3b8" }}><b>Unavailable (not invented):</b> {r.unavailable.join(", ")}</div>
          <div style={{ fontWeight: 800, color: r.ranked.length ? "#4cd08a" : "#facc15", margin: "4px 0" }}>{r.verdict}</div>
          {r.ranked.map((c, i) => (
            <div key={c.token} style={{ borderTop: "1px solid #1e293b", padding: "6px 0" }}>
              <b>#{i + 1} {c.symbol} {c.side === "BUY" ? "▲ BUY" : "▼ SELL"}</b> · ₹{c.ltp} ({c.chgPct}%) · score {c.score}/100 · {c.hits} hits<br />
              Trigger: {c.entryTrigger}<br />
              SL {c.stopLoss} · T1 {c.target1} · T2 {c.target2} · qty {c.qty} · risk ₹{c.riskAmount} · costs ≈ ₹{c.costRs} · net R at T1 {c.netR_T1}, T2 {c.netR_T2}<br />
              Why: {c.met.join("; ")} · traded ≈ ₹{c.tradedValueCr} cr<br />
              Invalid if: {c.invalidation}
            </div>
          ))}
          <div style={{ color: "#94a3b8", marginTop: 4 }}>{r.caveats}</div>
        </div>
      )}
    </div>
  );
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
  const [side, setSide] = useState("UP");
  const dn = side === "DOWN";
  const picks = (dn ? d?.downPicks : d?.picks) || [];
  const rows = (dn ? d?.downTop20 : d?.top20) || [];
  return (
    <section style={{ margin: "12px 0", padding: "12px 16px", background: "#080d1a", border: "1px solid #1e293b", borderRadius: 8 }}>
      <style>{`@keyframes bkBlink{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.0);background:#1a1606}50%{box-shadow:0 0 14px 3px rgba(250,204,21,.7);background:#2b2308}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#38bdf8" }}>🔥 TOP 20 BREAKOUT STOCKS (CHARTINK-STYLE)</span>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>live quotes, every 30 s{at ? `, last ${at}` : ""}</span>
      </div>
      <BotBox />
      <ResearchBox />
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {["UP", "DOWN"].map((k) => <button key={k} onClick={() => setSide(k)} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer", border: "1px solid #334155", background: side === k ? (k === "UP" ? "#14532d" : "#7f1d1d") : "transparent", color: "#e2e8f0", fontWeight: 700 }}>{k === "UP" ? "▲ BREAKOUT (BUY side)" : "▼ BREAKDOWN (SELL side)"}</button>)}
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>Error: {err}</div>}
      {d && picks.length === 0 && <div style={{ fontSize: 12, color: "#8b93a7", marginBottom: 8 }}>🤖 Pick bot: no stock meets 5+ of {n} {dn ? "breakdown" : "breakout"} conditions right now, so nothing to pick.</div>}
      {picks.map((x) => (
        <div key={x.token} style={{ animation: "bkBlink 1.2s infinite", border: "1px solid #facc15", borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 800, color: "#facc15" }}>🤖 {dn ? "PICK THIS (SELL side)" : "PICK THIS"}: {x.symbol} <span style={{ color: "#e2e8f0", fontWeight: 600 }}>@ {x.ltp.toFixed(2)} ({x.hits}/{n} hits)</span></span>
            {onPick && <button onClick={() => onPick(x)} style={{ background: "#facc15", color: "#111", border: 0, borderRadius: 4, padding: "3px 10px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Open chart</button>}
          </div>
          <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 4 }}><b>Why:</b> {dn ? whyDown(x) : why(x)}.</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Take it only if you also want the trade: this is a screen candidate, not a call. Past tests showed breakouts/breakdowns often fade, so use your own stop.</div>
        </div>
      ))}
      {d && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead><tr>{["#", "Stock", "LTP", "Chg %", dn ? "Off low %" : "Off high %", "To 52w %", "Hits", "Conditions met"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td style={td} colSpan={8}>No stock meets any condition right now.</td></tr>}
              {rows.map((x, i) => (
                <tr key={x.token}>
                  <td style={td}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{x.symbol}{x.hits >= 5 ? (dn ? " 🔻" : " 🔥") : ""}</td>
                  <td style={td}>{x.ltp.toFixed(2)}</td>
                  <td style={{ ...td, color: x.chgPct >= 0 ? "#4cd08a" : "#ff8a80" }}>{x.chgPct.toFixed(2)}</td>
                  <td style={td}>{(dn ? x.offDayLowPct : x.offDayHighPct)?.toFixed(2)}</td>
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
