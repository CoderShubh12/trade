"use client";
// Time Machine panel: enter a plan (side, entry, stop, target) for the stock on screen; get 10,000 bootstrap replays of the rest of the session
// from that stock's own last ~60 sessions plus the real record of the same plan on each past session. A simulation, not a prediction.
import { useEffect, useRef, useState } from "react";
const box = { background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6, padding: "4px 6px", width: 90, fontSize: 12 };

const clk = (bar) => { const m = 555 + 5 * bar; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
// Animated fan of simulated paths: each line is one replay, green = target first, red = stop first, grey = neither; the band is the 90% range of all 10,000.
function Fan({ v }) {
  const [step, setStep] = useState(0), [play, setPlay] = useState(true), t = useRef(null);
  useEffect(() => { setStep(0); setPlay(true); }, [v]);
  useEffect(() => { clearInterval(t.current); if (!play) return; t.current = setInterval(() => setStep((x) => { if (x >= v.bars - 1) { clearInterval(t.current); setPlay(false); return x; } return x + 1; }), 90); return () => clearInterval(t.current); }, [play, v]);
  const W = 640, H = 250, PL = 52, PR = 10, PT = 10, PB = 20, n = v.bars;
  const all = [v.stop, v.target, v.entry, ...v.band.p5, ...v.band.p95, ...v.samples.flatMap((s) => s.pts)], lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.04 || 1;
  const x = (j) => PL + (j / Math.max(1, n - 1)) * (W - PL - PR), y = (p) => PT + (1 - (p - lo + pad) / (hi - lo + 2 * pad)) * (H - PT - PB);
  const pts = (a, upto) => a.slice(0, upto + 1).map((p, j) => `${x(j).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const col = { T: "#22c55e", S: "#ef4444", N: "#64748b" };
  const hitsNow = v.samples.reduce((c, s) => { if (s.pts.length - 1 <= step) c[s.out] = (c[s.out] || 0) + 1; return c; }, {});
  const bandPoly = `${v.band.p95.slice(0, step + 1).map((p, j) => `${x(j)},${y(p)}`).join(" ")} ${v.band.p5.slice(0, step + 1).map((p, j) => [x(j), y(p)]).reverse().map((q) => q.join(",")).join(" ")}`;
  return (
    <div style={{ margin: "6px 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#0b1220", borderRadius: 8 }}>
        <rect x={PL} y={PT} width={W - PL - PR} height={Math.max(0, y(v.target) - PT)} fill={v.target > v.stop ? "#22c55e10" : "#ef444410"} />
        <line x1={PL} x2={W - PR} y1={y(v.target)} y2={y(v.target)} stroke="#22c55e" strokeDasharray="5,4" /><text x={4} y={y(v.target) + 3} fontSize="10" fill="#22c55e">T {v.target}</text>
        <line x1={PL} x2={W - PR} y1={y(v.stop)} y2={y(v.stop)} stroke="#ef4444" strokeDasharray="5,4" /><text x={4} y={y(v.stop) + 3} fontSize="10" fill="#ef4444">SL {v.stop}</text>
        <line x1={PL} x2={W - PR} y1={y(v.entry)} y2={y(v.entry)} stroke="#94a3b8" strokeDasharray="2,4" /><text x={4} y={y(v.entry) + 3} fontSize="10" fill="#94a3b8">E {v.entry}</text>
        {step > 0 && <polygon points={bandPoly} fill="#38bdf822" stroke="none" />}
        {v.samples.map((s, i) => { const e = Math.min(step, s.pts.length - 1); return (<g key={i}><polyline points={pts(s.pts, e)} fill="none" stroke={col[s.out]} strokeWidth={s.out === "N" ? 1 : 1.4} opacity={s.out === "N" ? 0.35 : 0.7} />
          {s.out !== "N" && s.pts.length - 1 <= step && <circle cx={x(s.pts.length - 1)} cy={y(s.pts[s.pts.length - 1])} r="3" fill={col[s.out]} />}</g>); })}
        {step > 0 && <polyline points={pts(v.band.med, step)} fill="none" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="3,2" />}
        <line x1={x(step)} x2={x(step)} y1={PT} y2={H - PB} stroke="#38bdf8" opacity="0.5" />
        <text x={PL} y={H - 5} fontSize="10" fill="#64748b">{clk(v.startBar)}</text><text x={x(step)} y={H - 5} fontSize="10" fill="#38bdf8" textAnchor="middle">{clk(v.startBar + step)}</text><text x={W - PR} y={H - 5} fontSize="10" fill="#64748b" textAnchor="end">{clk(v.startBar + n - 1)}</text>
      </svg>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, marginTop: 4, flexWrap: "wrap" }}>
        <button onClick={() => { setStep(0); setPlay(true); }} style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}>▶ Replay</button>
        <button onClick={() => { setPlay(false); setStep(n - 1); }} style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "2px 10px", cursor: "pointer" }}>⏩ Show all</button>
        <span>{v.samples.length} sample paths: <b style={{ color: "#22c55e" }}>{hitsNow.T || 0} target</b> · <b style={{ color: "#ef4444" }}>{hitsNow.S || 0} stop</b> so far</span>
        <span style={{ color: "#94a3b8" }}>blue band = 90% range of all replays, dashed white = median</span>
      </div>
    </div>
  );
}
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
        {r.viz && <Fan v={r.viz} />}
        <div>Target first <b style={{ color: "#22c55e" }}>{r.targetFirstPct}%</b> · Stop first <b style={{ color: "#ef4444" }}>{r.stopFirstPct}%</b> · Neither <b>{r.neitherPct}%</b> · Green {r.greenPct}% · Avg R {r.avgR}</div>
        <div>Price at {f.until}: median ₹{r.closePrice.median}, 90% between ₹{r.closePrice.p5} and ₹{r.closePrice.p95}</div>
        <div>History ({r.history.sessions} real sessions, same % plan): {r.history.target} target · {r.history.stop} stop · {r.history.neither} neither · avg R {r.history.avgR}</div>
        <div style={{ fontWeight: 700 }}>{r.verdict}: needs target in {r.breakEvenTargetShare}% of the hits to break even (R:R {r.rr}); got {r.targetShareOfHits}%.</div>
        {(r.verdictNotes || []).map((n, i) => <div key={i} style={{ fontSize: 11 }}>{n}</div>)}
        <div style={{ color: "#94a3b8", fontSize: 11 }}>{r.sessions} sessions · seed {r.seed}. {r.note}</div>
      </div>)}
    </div>
  );
}
