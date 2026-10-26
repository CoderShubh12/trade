"use client";
// Stock Picker panel: which sector is strong, which stocks lead it with volume and a day-high breakout, and what the headlines say. A ranked watchlist, not a prediction.
import { useEffect, useState } from "react";
export default function StockPicker({ onPick }) {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; const go = async () => { try { const j = await (await fetch("/api/picker", { cache: "no-store" })).json(); if (live) setD(j); } catch {} }; go(); const t = setInterval(go, 90000); return () => { live = false; clearInterval(t); }; }, []);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 className="card-title">🎯 Stock Picker (sector → volume → breakout → news)</h2>
      {!d ? <div style={{ fontSize: 12 }}>Loading quotes…</div> : !d.success ? <div style={{ fontSize: 12, color: "#f87171" }}>{d.error}</div> : (<>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 8px" }}>
          {d.sectors.map((s) => (<span key={s.sector} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: s.avgChgPct >= 0 ? "#14532d55" : "#7f1d1d55", color: s.avgChgPct >= 0 ? "#86efac" : "#fca5a5" }}>{s.sector} {s.avgChgPct >= 0 ? "+" : ""}{s.avgChgPct}% · {s.breadthPct}% up</span>))}
        </div>
        {d.top.map((t) => (
          <div key={t.symbol} onClick={() => onPick && onPick(t)} style={{ fontSize: 12, padding: "5px 0", borderBottom: "1px solid #1e293b", cursor: onPick ? "pointer" : "default" }}>
            <b>{t.symbol}</b> ₹{t.ltp} <span style={{ color: t.chgPct >= 0 ? "#22c55e" : "#ef4444" }}>{t.chgPct >= 0 ? "+" : ""}{t.chgPct}%</span> · {t.sector} · score <b>{t.score}</b>{t.rvol != null ? ` · vol ${t.rvol}x` : ""}
            <div style={{ color: "#94a3b8", fontSize: 11 }}>{t.why.length ? t.why.join(" · ") : "no strong reason"}</div>
            {(t.news || []).map((n, i) => <div key={i} style={{ color: "#64748b", fontSize: 10 }}>📰 {n}</div>)}
          </div>
        ))}
        <div style={{ fontSize: 11, marginTop: 6 }}><b>Forward record</b> ({d.forward.loggedDays} logged day{d.forward.loggedDays === 1 ? "" : "s"}): next-day avg {d.forward.avg1dPct ?? "-"}% (n={d.forward.n}, cost 0.1%)</div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{d.volumeNote} {d.note}</div>
      </>)}
    </section>
  );
}
