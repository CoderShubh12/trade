"use client";
// Popup + beep + list when the pattern watcher finds a new double bottom (W) / double top (M) in the stock pool. Alerts only.
import { useEffect, useState } from "react";
const seenGet = () => { try { return new Set(JSON.parse(sessionStorage.getItem("paSeen") || "[]")); } catch { return new Set(); } };
const seenPut = (s) => { try { sessionStorage.setItem("paSeen", JSON.stringify([...s].slice(-300))); } catch {} };
function beep() { try { const A = window.AudioContext || window.webkitAudioContext, c = new A(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 988; g.gain.value = 0.08; o.start(); setTimeout(() => { o.stop(); c.close(); }, 300); } catch {} }
export default function PatternAlerts() {
  const [d, setD] = useState(null), [toasts, setToasts] = useState([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const j = await (await fetch("/api/pattern-alerts", { cache: "no-store" })).json();
        if (!live || !j.success) return; setD(j);
        const seen = seenGet(), fresh = j.alerts.filter((a) => !seen.has(a.id) && Date.now() - a.t < 15 * 60000);
        j.alerts.forEach((a) => seen.add(a.id)); seenPut(seen);
        if (fresh.length) { beep(); setToasts((t) => [...fresh.slice(0, 3).map((a) => ({ id: a.id, a })), ...t].slice(0, 4)); }
      } catch {}
    };
    load(); const id = setInterval(load, 20000); return () => { live = false; clearInterval(id); };
  }, []);
  const label = (a) => (a.side === "BUY" ? `${a.confirmed ? "Double bottom confirmed" : "Double bottom forming"} (bullish)` : `${a.confirmed ? "Double top confirmed" : "Double top forming"} (bearish)`);
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <style>{`@keyframes paBlink{0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,.7)}50%{box-shadow:0 0 14px 4px rgba(250,204,21,.5)}}`}</style>
      <div style={{ position: "fixed", top: 14, right: 14, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, width: "min(380px,92vw)" }}>
        {toasts.map(({ id, a }) => (
          <div key={id} style={{ animation: "paBlink 1.2s infinite", border: `2px solid ${a.side === "BUY" ? "#22c55e" : "#ef4444"}`, borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", background: "#0f172a" }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{a.side === "BUY" ? "📈" : "📉"} {a.symbol}: {label(a)}</div>
            <div style={{ fontSize: 12, marginTop: 3 }}>{a.rule} @ ₹{a.price} · bar {a.barTime.slice(11)}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>Alert only, not a proven edge.</div>
            <button onClick={() => setToasts((t) => t.filter((x) => x.id !== id))} style={{ marginTop: 6, background: "#facc15", color: "#111", border: 0, borderRadius: 4, padding: "2px 10px", fontWeight: 700, cursor: "pointer", fontSize: 11 }}>OK</button>
          </div>
        ))}
      </div>
      <h2 className="card-title">🔔 Pattern alerts (double bottom / double top)</h2>
      {!d ? <div style={{ fontSize: 12 }}>Loading…</div> : (<>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Scans the pool every 3 min (09:35–15:20). Last scan {d.lastScan ? new Date(d.lastScan).toLocaleTimeString("en-IN") : "not yet"} · {d.scanned} stocks{d.failed ? ` · ${d.failed} failed` : ""}{d.error ? ` · ${d.error}` : ""}</div>
        {d.alerts.length === 0 ? <div style={{ fontSize: 12 }}>No new pattern yet today.</div> : d.alerts.slice(0, 12).map((a) => (
          <div key={a.id} style={{ fontSize: 12, padding: "3px 0", borderBottom: "1px solid #1e293b" }}>
            <b style={{ color: a.side === "BUY" ? "#22c55e" : "#ef4444" }}>{a.side === "BUY" ? "BULLISH" : "BEARISH"}</b> {a.symbol} · {label(a)} @ ₹{a.price} · {a.barTime.slice(11)}
          </div>
        ))}
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{d.note}</div>
      </>)}
    </section>
  );
}
