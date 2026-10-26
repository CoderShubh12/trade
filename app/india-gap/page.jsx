"use client";
// /india-gap - paper-only NSE vs BSE price-gap scanner for the stock pool. Measures whether any gap survives costs; it never trades.
import { useEffect, useState } from "react";
const th = { textAlign: "left", padding: "6px 8px", color: "#8b93a7", fontSize: 12, borderBottom: "1px solid #232838" };
const td = { padding: "5px 8px", fontSize: 12, borderBottom: "1px solid #1b2030" };
export default function IndiaGap() {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; const load = async () => { try { const j = await (await fetch("/api/india-gap", { cache: "no-store" })).json(); if (live) setD(j); } catch {} }; load(); const id = setInterval(load, 5000); return () => { live = false; clearInterval(id); }; }, []);
  return (
    <div style={{ background: "#0d1017", minHeight: "100vh", color: "#e6e9f2", padding: "20px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <a href="/" style={{ color: "#6ea8fe", fontSize: 13 }}>← Terminal</a>
        <h1 style={{ fontSize: 22, margin: "10px 0 4px" }}>NSE vs BSE price-gap scanner (paper only)</h1>
        <div style={{ color: "#8b93a7", fontSize: 12, marginBottom: 10 }}>For each stock listed on both exchanges: buy at the lower ask, sell at the higher bid, every 5 s. Net = gross − estimated costs − 0.02% slippage. It measures only; it places no orders.</div>
        {!d && <div>Loading…</div>}
        {d && !d.success && <div style={{ color: "#ff8a80" }}>{d.error}</div>}
        {d && d.success && (<>
          <div style={{ fontSize: 13, marginBottom: 8 }}>Running {d.minutes} min · {d.polls} polls · {d.pairsMatched} stocks matched on NSE+BSE{d.mapError ? <span style={{ color: "#ff8a80" }}> · token map: {d.mapError}</span> : null}{d.error ? <span style={{ color: "#ff8a80" }}> · quote error: {d.error}</span> : null}</div>
          {d.debug && <pre style={{ fontSize: 11, color: "#8b93a7", whiteSpace: "pre-wrap" }}>{JSON.stringify(d.debug)}</pre>}
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Stock", "Ticks", "Now: buy → sell", "Gross %", "Net %", "Avg gross %", "Max gross %", "Max net %", "Ticks net>0"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.rows.map((r) => (<tr key={r.symbol}><td style={{ ...td, fontWeight: 700 }}>{r.symbol}</td><td style={td}>{r.ticks}</td><td style={td}>{r.now ? `${r.now.buy} → ${r.now.sell}` : "-"}</td><td style={td}>{r.now?.grossPct ?? "-"}</td><td style={{ ...td, color: r.now?.netPct > 0 ? "#4cd08a" : "#ff8a80" }}>{r.now?.netPct ?? "-"}</td><td style={td}>{r.avgGrossPct}</td><td style={td}>{r.maxGrossPct}</td><td style={{ ...td, color: r.maxNetPct > 0 ? "#4cd08a" : "#ff8a80" }}>{r.maxNetPct}</td><td style={td}>{r.ticksNetPositive}</td></tr>))}</tbody>
          </table></div>
          <div style={{ color: "#8b93a7", fontSize: 12, marginTop: 10 }}>{d.note}</div>
          {d.recentNetPositive.length > 0 && <div style={{ marginTop: 10, fontSize: 12 }}><b>Recent net-positive ticks (before latency):</b>{d.recentNetPositive.map((e, i) => <div key={i}>{new Date(e.t).toLocaleTimeString("en-IN")} {e.symbol}: buy {e.buy} @ {e.buyAsk}, sell {e.sell} @ {e.sellBid}, gross {e.grossPct}%, net {e.netPct}%, qty at best {e.qtyAtBest}</div>)}</div>}
        </>)}
      </div>
    </div>
  );
}
