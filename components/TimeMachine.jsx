"use client";
// Time Machine panel: enter a plan (side, entry, stop, target) for the stock on screen; get 10,000 bootstrap replays of the rest of the session
// from that stock's own last ~60 sessions plus the real record of the same plan on each past session. A simulation, not a prediction.
import { useEffect, useState } from "react";
const box = { background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6, padding: "4px 6px", width: 90, fontSize: 12 };
export default function TimeMachine({ symbol, token, price }) {
  const [f, setF] = useState({ side: "BUY", entry: "", stop: "", target: "", entryTime: "10:15", until: "15:15" });
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { // prefill from the live price: 0.5% stop, 1R target
    if (!(price > 0)) return; const e = +price, d = f.side === "BUY" ? 1 : -1;
    setF((x) => ({ ...x, entry: e.toFixed(2), stop: (e * (1 - d * 0.005)).toFixed(2), target: (e * (1 + d * 0.005)).toFixed(2) })); setRes(null);
  }, [token, f.side]); // eslint-disable-line
  const run = async () => {
    setBusy(true); setRes(null);
    try { const q = new URLSearchParams({ token: String(token), side: f.side, entry: f.entry, stop: f.stop, target: f.target, entryTime: f.entryTime, until: f.until });
      setRes(await (await fetch(`/api/time-machine?${q}`, { cache: "no-store" })).json()); } catch { setRes({ success: false, error: "Request failed" }); }
    setBusy(false);
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const r = res && res.success ? res : null;
  return (
    <div className="card" style={{ marginTop: 8, padding: "8px 10px" }}>
      <b style={{ fontSize: 13 }}>⏳ Time Machine · {symbol}</b>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "6px 0", fontSize: 12 }}>
        <select value={f.side} onChange={set("side")} style={box}><option>BUY</option><option>SELL</option></select>
        Entry <input style={box} value={f.entry} onChange={set("entry")} /> SL <input style={box} value={f.stop} onChange={set("stop")} /> Target <input style={box} value={f.target} onChange={set("target")} />
        From <input style={{ ...box, width: 60 }} value={f.entryTime} onChange={set("entryTime")} /> Until <input style={{ ...box, width: 60 }} value={f.until} onChange={set("until")} />
        <button onClick={run} disabled={busy} style={{ background: "#38bdf8", color: "#0b1220", border: 0, borderRadius: 6, padding: "4px 12px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Running…" : "Run 10,000 replays"}</button>
      </div>
      {res && !r && <div style={{ fontSize: 12, color: "#f87171" }}>{res.error}</div>}
      {r && (<div style={{ fontSize: 12, lineHeight: 1.6 }}>
        <div>Target first <b style={{ color: "#22c55e" }}>{r.targetFirstPct}%</b> · Stop first <b style={{ color: "#ef4444" }}>{r.stopFirstPct}%</b> · Neither <b>{r.neitherPct}%</b> · Green {r.greenPct}% · Avg R {r.avgR}</div>
        <div>Price at {f.until}: median ₹{r.closePrice.median}, 90% between ₹{r.closePrice.p5} and ₹{r.closePrice.p95}</div>
        <div>History ({r.history.sessions} real sessions, same % plan): {r.history.target} target · {r.history.stop} stop · {r.history.neither} neither · avg R {r.history.avgR}</div>
        <div style={{ fontWeight: 700 }}>{r.verdict}: needs target in {r.breakEvenTargetShare}% of the hits to break even (R:R {r.rr}); got {r.targetShareOfHits}%.</div>
        <div style={{ color: "#94a3b8", fontSize: 11 }}>{r.sessions} sessions · seed {r.seed}. {r.note}</div>
      </div>)}
    </div>
  );
}
