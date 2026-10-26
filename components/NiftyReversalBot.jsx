"use client";
// Nifty reversal bot: traces today's Nifty 5m chart, marks causal reversal points, shows recent market headlines and pops up on a NEW reversal.
// Heads-up only. Rule replay on 44 stocks (63 days): next-6-bar move in the alert direction hit 46.6% (train) / 48.4% (test), mean -0.007%: no edge.
import { useEffect, useRef, useState } from "react";

function Trace({ bars, events }) {
  const W = 640, H = 170, P = 8;
  if (!bars || bars.length < 2) return null;
  const hi = Math.max(...bars.map((b) => b.high)), lo = Math.min(...bars.map((b) => b.low)), rg = hi - lo || 1;
  const x = (i) => P + (i / (bars.length - 1)) * (W - 2 * P), y = (v) => P + (1 - (v - lo) / rg) * (H - 2 * P);
  const idx = new Map(bars.map((b, i) => [`${b.date} ${b.clock}`, i]));
  const path = bars.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 170, background: "#080c14", borderRadius: 6 }}>
      <path d={path} fill="none" stroke="#6ea8fe" strokeWidth="1.5" />
      <line x1={P} x2={W - P} y1={y(bars[0].open)} y2={y(bars[0].open)} stroke="#475569" strokeDasharray="4,4" />
      <text x={W - P} y={y(hi) + 10} fontSize="9" fill="#64748b" textAnchor="end">{hi.toFixed(0)}</text>
      <text x={W - P} y={y(lo) - 3} fontSize="9" fill="#64748b" textAnchor="end">{lo.toFixed(0)}</text>
      {events.map((e, k) => { const i = idx.get(e.key); if (i == null) return null; const up = e.dir === "UP", cx = x(i), cy = y(e.price), col = up ? "#2FD98A" : "#FF5D5D";
        return (<g key={k}><title>{`${up ? "Bullish" : "Bearish"} reversal ${e.key.slice(11)} @ ${e.price} (${e.met.join(", ")})${e.afterPct == null ? "" : `; next 6 bars ${e.afterPct}% in that direction`}`}</title>
          <line x1={x(i)} x2={x(i)} y1={y(e.extreme)} y2={cy} stroke={col} strokeDasharray="2,2" />
          <polygon points={up ? `${cx},${cy - 9} ${cx - 6},${cy + 2} ${cx + 6},${cy + 2}` : `${cx},${cy + 9} ${cx - 6},${cy - 2} ${cx + 6},${cy - 2}`} fill={col} stroke="#0b1220" /></g>); })}
      <text x={P} y={H - 3} fontSize="9" fill="#64748b">{bars[0].clock}</text>
      <text x={W - P} y={H - 3} fontSize="9" fill="#64748b" textAnchor="end">{bars[bars.length - 1].clock}</text>
    </svg>
  );
}

export default function NiftyReversalBot() {
  const [d, setD] = useState(null), [err, setErr] = useState(""), [pop, setPop] = useState(null);
  const seen = useRef(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const j = await (await fetch("/api/nifty-reversal", { cache: "no-store" })).json();
        if (!live) return;
        if (!j.success) throw new Error(j.error || "failed");
        setD(j); setErr("");
        if (seen.current === null) { // first load: remember existing events, only NEW ones pop up
          let s = []; try { s = JSON.parse(sessionStorage.getItem("niftyRevSeen") || "[]"); } catch {}
          seen.current = new Set([...s, ...j.events.map((e) => e.key + e.dir)]);
          try { sessionStorage.setItem("niftyRevSeen", JSON.stringify([...seen.current])); } catch {}
          return;
        }
        const fresh = j.events.filter((e) => !seen.current.has(e.key + e.dir));
        if (fresh.length) { fresh.forEach((e) => seen.current.add(e.key + e.dir)); try { sessionStorage.setItem("niftyRevSeen", JSON.stringify([...seen.current])); } catch {} setPop(fresh[fresh.length - 1]); }
      } catch (e) { if (live) setErr(String(e.message || e)); }
    };
    load(); const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);
  const last = d?.events?.[d.events.length - 1];
  const hot = (d?.news || []).filter((n) => n.keyword && n.ageMin != null && n.ageMin <= 180);
  return (
    <section style={{ margin: "12px 0", padding: "12px 16px", background: "#080d1a", border: "1px solid #1e293b", borderRadius: 8 }}>
      <style>{`@keyframes nrPop{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,0)}50%{box-shadow:0 0 22px 6px rgba(250,204,21,.8)}}`}</style>
      {pop && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 9999, width: "min(520px, 92vw)", background: "#1a1606", border: `2px solid ${pop.dir === "UP" ? "#2FD98A" : "#FF5D5D"}`, borderRadius: 10, padding: "12px 16px", animation: "nrPop 1.2s infinite", color: "#e2e8f0" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{pop.dir === "UP" ? "▲ NIFTY BULLISH REVERSAL" : "▼ NIFTY BEARISH REVERSAL"} <span style={{ fontWeight: 500, fontSize: 12 }}>{pop.key.slice(11)} @ {pop.price}</span></div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Fell/rose {pop.movePct}% to {pop.extreme}; confirmed by: {pop.met.join(", ")} ({pop.score}/3).</div>
          {hot[0] && <div style={{ fontSize: 12, marginTop: 4 }}>📰 Possible news catalyst ({hot[0].keyword}, {hot[0].ageMin} min ago): {hot[0].title}</div>}
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Heads-up only, not an entry. Past tests found no follow-through after such alerts.</div>
          <button onClick={() => setPop(null)} style={{ marginTop: 8, background: "#facc15", color: "#111", border: 0, borderRadius: 4, padding: "3px 12px", fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#a78bfa" }}>🔄 NIFTY REVERSAL BOT (chart + news)</span>
        <span style={{ fontSize: 11, color: "#8b93a7" }}>{d ? `data ${new Date(d.dataAt).toLocaleTimeString("en-IN")} · ${d.source || ""} · last candle ${d.lastBar || "-"} · refresh 30 s` : ""}</span>
      </div>
      {err && <div style={{ color: "#ff8a80", fontSize: 12 }}>Error: {err}</div>}
      {d && <Trace bars={d.bars} events={d.events} />}
      {d && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <div><b>Latest reversal today:</b> {last ? `${last.dir === "UP" ? "▲ bullish" : "▼ bearish"} at ${last.key.slice(11)} @ ${last.price} (${last.met.join(", ")})` : "none yet"} · {d.events.length} today</div>
          <div style={{ marginTop: 4 }}><b>Headlines (last day):</b>{(d.news || []).length === 0 ? " unavailable right now" : ""}</div>
          {(d.news || []).slice(0, 5).map((n, i) => <div key={i} style={{ color: n.keyword ? "#facc15" : "#94a3b8", fontSize: 11 }}>{n.keyword ? "● " : "○ "}{n.title}{n.source ? ` — ${n.source}` : ""}{n.ageMin != null ? ` (${n.ageMin < 90 ? `${n.ageMin} min` : `${Math.round(n.ageMin / 60)} h`} ago)` : ""}</div>)}
          <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>{d.note} In a 63-day test the alert direction held for the next 6 bars only 46.6% / 48.4% of the time (train / test).</div>
        </div>
      )}
    </section>
  );
}
