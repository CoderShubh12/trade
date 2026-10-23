"use client";
// "My Calls": the user's own predictions, paper-tracked on live quotes (SL / T1 / 15:15), net of estimated costs. Hit-rate is shown honestly.
import { useEffect, useState } from "react";

const th = { textAlign: "left", padding: "4px 6px", color: "#8b93a7", fontWeight: 600, fontSize: 10, borderBottom: "1px solid #1e293b" };
const td = { padding: "4px 6px", fontSize: 11, borderBottom: "1px solid #131a2b" };
const inp = { background: "#0d1424", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "3px 6px", fontSize: 12 };

export default function MyCalls() {
  const [d, setD] = useState(null), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [f, setF] = useState({ symbol: "", side: "BUY", stopLoss: "", target1: "", qty: "", note: "" });
  const load = async () => { try { setD(await (await fetch("/api/my-calls", { cache: "no-store" })).json()); } catch {} };
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, []);
  const submit = async () => {
    setBusy(true); setMsg("");
    try { const j = await (await fetch("/api/my-calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) })).json(); setMsg(j.success ? `Saved: ${j.call.side} ${j.call.symbol} @ ${j.call.entry}, qty ${j.call.qty}` : j.error); if (j.success) { setF({ ...f, stopLoss: "", target1: "", qty: "", note: "" }); load(); } } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };
  const close = async (id) => { try { await fetch("/api/my-calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ close: id }) }); load(); } catch {} };
  const s = d?.stats;
  return (
    <section style={{ margin: "12px 0", padding: "12px 16px", background: "#080d1a", border: "1px solid #1e293b", borderRadius: 8 }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#34d399", marginBottom: 4 }}>✍️ MY CALLS (paper tracker)</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Entry = live price when you save. Exit at your SL, your target (T1), or 15:15. Result is net of estimated costs. Default qty = 0.5% risk of ₹1,00,000 (or type qty).</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <input list="mc-sym" placeholder="Stock" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} style={{ ...inp, width: 110 }} />
        <datalist id="mc-sym">{(d?.symbols || []).map((x) => <option key={x} value={x} />)}</datalist>
        <select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })} style={inp}><option>BUY</option><option>SELL</option></select>
        <input placeholder="Stop-loss" type="number" step="0.05" value={f.stopLoss} onChange={(e) => setF({ ...f, stopLoss: e.target.value })} style={{ ...inp, width: 90 }} />
        <input placeholder="Target" type="number" step="0.05" value={f.target1} onChange={(e) => setF({ ...f, target1: e.target.value })} style={{ ...inp, width: 90 }} />
        <input placeholder="Qty (opt)" type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} style={{ ...inp, width: 80 }} />
        <input placeholder="Why (note)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} style={{ ...inp, width: 170 }} />
        <button onClick={submit} disabled={busy} style={{ background: "#059669", color: "#fff", border: 0, borderRadius: 4, padding: "4px 12px", fontWeight: 700, cursor: "pointer" }}>{busy ? "…" : "Save call"}</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: msg.startsWith("Saved") ? "#4cd08a" : "#ff8a80", marginBottom: 4 }}>{msg}</div>}
      {d?.error && <div style={{ fontSize: 11, color: "#ff8a80" }}>Quotes: {d.error}</div>}
      {s && <div style={{ fontSize: 12, marginBottom: 4 }}>{s.total} calls · {s.open} open · {s.closed} closed · wins {s.wins}{s.hitRate != null ? ` (${s.hitRate}%)` : ""} · net {s.netR}R ≈ ₹{s.netRs} after costs{s.closed < 30 ? <span style={{ color: "#94a3b8" }}> · fewer than 30 closed calls: too few to judge</span> : null}</div>}
      {d?.calls?.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Date", "Time", "Stock", "Side", "Entry", "SL", "Target", "Now/Exit", "Status", "Net R", "Note", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{d.calls.map((c) => {
              const dir = c.side === "BUY" ? 1 : -1, live = c.status === "OPEN" && c.ltp ? ((c.ltp - c.entry) * dir * c.qty) / (Math.abs(c.entry - c.stopLoss) * c.qty) : null;
              return (<tr key={c.id}><td style={td}>{c.date.slice(5)}</td><td style={td}>{c.entryClock}</td><td style={{ ...td, fontWeight: 700 }}>{c.symbol}</td><td style={{ ...td, color: c.side === "BUY" ? "#4cd08a" : "#ff8a80" }}>{c.side}</td><td style={td}>{c.entry}</td><td style={td}>{c.stopLoss}</td><td style={td}>{c.target1 || "-"}</td><td style={td}>{c.status === "OPEN" ? c.ltp ?? "-" : c.exit}</td><td style={td}>{c.status === "OPEN" ? "OPEN" : c.reason}</td><td style={{ ...td, color: (c.r ?? live) > 0 ? "#4cd08a" : (c.r ?? live) < 0 ? "#ff8a80" : "#e2e8f0" }}>{c.status === "OPEN" ? (live == null ? "-" : `${live.toFixed(2)} (gross)`) : c.r}</td><td style={{ ...td, color: "#94a3b8" }}>{c.note}</td><td style={td}>{c.status === "OPEN" && <button onClick={() => close(c.id)} style={{ fontSize: 10, cursor: "pointer" }}>Close</button>}</td></tr>);
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
