"use client";
// Pre-market daily scan panel: stocks that matched bull_flag / reclaim_ma20 on daily closes, plus the forward record of past logged hits. A watchlist, not a buy list.
import { useEffect, useState } from "react";
export default function DailyScan({ onPick }) {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; (async () => { try { const j = await (await fetch("/api/daily-scan", { cache: "no-store" })).json(); if (live) setD(j); } catch {} })(); return () => { live = false; }; }, []);
  const fw = d?.forward;
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 className="card-title">🌅 Pre-market daily scan (swing watchlist)</h2>
      {!d ? <div style={{ fontSize: 12 }}>Scanning daily charts… (about 15 s)</div> : !d.success ? <div style={{ fontSize: 12, color: "#f87171" }}>{d.error}</div> : (<>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Data to {d.asOf} · {d.scanned} charts{d.failed ? ` · ${d.failed} failed` : ""} · {d.hits.length} matched a rule</div>
        {d.hits.length === 0 ? <div style={{ fontSize: 12 }}>No stock matched bull flag / 20-day-average reclaim / dip in uptrend.</div> : d.hits.map((h) => (
          <div key={h.symbol + h.setup} onClick={() => onPick && onPick(h)} style={{ fontSize: 12, padding: "3px 0", borderBottom: "1px solid #1e293b", cursor: onPick ? "pointer" : "default" }}>
            <b>{h.symbol}</b> ₹{h.close} · <span style={{ color: "#38bdf8" }}>{h.setup}</span> · {h.why} · traded ₹{h.traded} cr
          </div>
        ))}
        {fw && <div style={{ fontSize: 11, marginTop: 6 }}><b>Forward record</b> ({d.loggedDays} logged day{d.loggedDays === 1 ? "" : "s"}, cost 0.1%): {Object.entries(fw).map(([k, v]) => `${k}: 1d ${v.avg1Pct ?? "-"}% (n=${v.n1}), 5d ${v.avg5Pct ?? "-"}% (n=${v.n5})`).join(" · ")}</div>}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{d.note}</div>
      </>)}
    </section>
  );
}
