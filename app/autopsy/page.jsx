'use client';
// /autopsy : "reverse tracking". For each closed paper trade, the day's 5m chart with entry / stop / T1 / exit and a plain explanation of what happened.
// Top section = the multi-stock summary (analysis/autopsy_summary.json) of why simulated trades fail. Explanation only; it never changes a call.
import { useEffect, useState } from 'react';
import Link from 'next/link';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 14, marginBottom: 14 };
const muted = { color: 'var(--text-muted)' };
const CAUSE = { TIME_DECAY: 'Time decay (nothing happened in 25 min)', TREND_AGAINST: 'Price moved straight against the call', LATE_ENTRY: 'Late entry (far from VWAP)', NOISE_STOP: 'Stopped by a wick, then recovered', GAP: 'Gap through the stop', NEWS_RISK: 'News / event risk', OTHER: 'Other', SCRATCH: 'Scratch' };
const fix = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

function Chart({ t }) {
  const { bars, vwap, entryIdx, exitIdx } = t.chart;
  if (!bars.length) return null;
  const a = Math.max(0, entryIdx - 14), b = Math.min(bars.length - 1, exitIdx + 10);
  const view = bars.slice(a, b + 1);
  const L = t.levels;
  const lv = [L.entry, L.stop, L.t1, L.exit].filter(Number.isFinite);
  const hi = Math.max(...view.map((x) => x[2]), ...lv), lo = Math.min(...view.map((x) => x[3]), ...lv);
  const W = 640, H = 230, padL = 8, padR = 62, padT = 10, padB = 18;
  const y = (p) => padT + ((hi - p) / (hi - lo || 1)) * (H - padT - padB);
  const step = (W - padL - padR) / view.length, bw = Math.max(2, step * 0.6);
  const x = (i) => padL + step * (i + 0.5);
  const vw = vwap.slice(a, b + 1);
  const line = (p, color, label, dash) => Number.isFinite(p) ? (
    <g key={label}>
      <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke={color} strokeWidth="1" strokeDasharray={dash || '0'} opacity="0.9" />
      <text x={W - padR + 4} y={y(p) + 3} fontSize="10" fill={color}>{label} {fix(p)}</text>
    </g>
  ) : null;
  const up = 'var(--accent-green)', dn = 'var(--accent-red)';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`${t.symbol} ${t.side} ${t.date} trade chart`}>
      {view.map((c, i) => {
        const col = c[4] >= c[1] ? up : dn;
        const inTrade = a + i >= entryIdx && a + i <= exitIdx;
        return (
          <g key={c[0]} opacity={inTrade ? 1 : 0.55}>
            <line x1={x(i)} x2={x(i)} y1={y(c[2])} y2={y(c[3])} stroke={col} strokeWidth="1" />
            <rect x={x(i) - bw / 2} y={Math.min(y(c[1]), y(c[4]))} width={bw} height={Math.max(1, Math.abs(y(c[1]) - y(c[4])))} fill={col} />
          </g>
        );
      })}
      <polyline fill="none" stroke="var(--accent-yellow)" strokeWidth="1.2" opacity="0.8" points={vw.map((v, i) => (v ? `${x(i)},${y(v)}` : null)).filter(Boolean).join(' ')} />
      {line(L.entry, 'var(--text-main)', 'entry', '0')}
      {line(L.stop, 'var(--accent-red)', 'stop', '4 3')}
      {line(L.t1, 'var(--accent-green)', 'T1', '4 3')}
      {Number.isFinite(L.exit) ? <circle cx={x(exitIdx - a)} cy={y(L.exit)} r="5" fill="none" stroke="var(--accent-blue)" strokeWidth="2" /> : null}
      <circle cx={x(entryIdx - a)} cy={y(L.entry)} r="4" fill="var(--text-main)" />
      <text x={x(0)} y={H - 4} fontSize="10" fill="var(--text-muted)">{view[0][0]}</text>
      <text x={x(view.length - 1) - 24} y={H - 4} fontSize="10" fill="var(--text-muted)">{view[view.length - 1][0]}</text>
    </svg>
  );
}

function Bar({ label, pct, n, color }) {
  return (
    <div style={{ margin: '5px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{label}</span><span style={muted}>{n} · {pct}%</span></div>
      <div style={{ height: 6, background: 'var(--bg-card-subtle)', borderRadius: 3 }}><div style={{ height: 6, width: `${Math.min(100, pct)}%`, background: color || 'var(--accent-blue)', borderRadius: 3 }} /></div>
    </div>
  );
}

function Aggregate({ ag }) {
  if (!ag) return <div style={{ ...card, fontSize: 13, ...muted }}>No multi-stock summary yet. Run <code>node analysis/.build/autopsy_batch.mjs</code> (see ROADMAP.md) to create analysis/autopsy_summary.json.</div>;
  const o = ag.overall?.all, causes = Object.entries(ag.losses?.byCause || {});
  const ex = Object.entries(ag.byExitReason || {});
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, ...muted }}>WHY SIMULATED TRADES FAIL</span>
        <span style={{ fontSize: 11, ...muted }}>{ag.generatedFor}</span>
      </div>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Terminal logic replayed on history: <b>{o?.n}</b> trades, win rate <b>{o?.win}%</b>, profit factor <b>{o?.pf}</b>, net <b>{o?.avgNetR}R</b> per trade after costs
        {' '}(test half PF {ag.overall?.test?.pf}). This is a diagnostic of why trades lose, not a promise of profit.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Losing trades by cause ({ag.losses?.n})</div>
          {causes.map(([k, v]) => <Bar key={k} label={CAUSE[k] || k} pct={v.pct} n={v.n} color={k === 'TIME_DECAY' ? 'var(--accent-yellow)' : k === 'TREND_AGAINST' ? 'var(--accent-red)' : 'var(--accent-blue)'} />)}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>How trades ended</div>
          {ex.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border-color)' }}>
              <span>{k}</span><span style={muted}>{v.n} · win {v.win}% · {v.avgNetR}R</span>
            </div>
          ))}
          <div style={{ fontSize: 12, marginTop: 8, ...muted }}>
            Only {ag.mfe?.allTrades?.['>=1.67R (T1 distance)']} of {o?.n} trades ever moved as far as T1. {ag.mfe?.lossesWhereT1WasReachable}% of the losers did.
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeCard({ t }) {
  const win = t.outcome === 'WIN', col = win ? 'var(--accent-green)' : t.outcome === 'LOSS' ? 'var(--accent-red)' : 'var(--text-muted)';
  return (
    <div style={{ ...card, borderLeft: `3px solid ${col}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>{t.symbol} <span style={{ color: t.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{t.side}</span> <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>{t.date} {t.entryClock} → {t.exitClock}</span></div>
        <div style={{ fontSize: 13 }}><span style={{ color: col, fontWeight: 700 }}>{t.outcome} {t.rReal > 0 ? '+' : ''}{t.rReal}R</span>{t.cause && t.cause !== 'NONE' ? <span style={muted}> · {CAUSE[t.cause] || t.cause}</span> : null}</div>
      </div>
      <Chart t={t} />
      <div style={{ fontSize: 10, ...muted, margin: '4px 0 8px' }}>Candles + yellow VWAP line · solid = entry, red dashed = stop, green dashed = T1, blue ring = exit · source: {t.source}</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
        <span>Best move <b>{t.mfeR}R</b></span><span>Worst <b>{t.maeR}R</b></span><span>Target needs <b>{t.t1R ?? '–'}R</b> ({t.t1Reachable ? 'touched' : 'not reached'})</span>
        <span>Held <b>{t.barsHeld * 5} min</b></span><span>Exit <b>{t.exitReason || '–'}</b></span>
      </div>
      {t.explain.map((l, i) => <div key={i} style={{ fontSize: 13, padding: '2px 0' }}>{l}</div>)}
    </div>
  );
}

export default function Autopsy() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    setBusy(true); setErr('');
    fetch('/api/autopsy?limit=30', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.error || 'failed'); setData(j); })
      .catch((e) => setErr(String(e.message || e))).finally(() => setBusy(false));
  };
  useEffect(load, []);
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '16px 16px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 18 }}>Trade Autopsy</h1>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button onClick={load} disabled={busy} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer', fontSize: 12 }}>{busy ? 'Loading…' : 'Refresh'}</button>
          <Link href="/" style={{ color: 'var(--accent-blue)', fontSize: 13 }}>← Terminal</Link>
        </div>
      </div>
      {err ? <div style={{ color: 'var(--accent-red)', marginBottom: 12, fontSize: 13 }}>{err}</div> : null}
      {!data ? <div style={muted}>{busy ? 'Loading…' : ''}</div> : (
        <>
          <Aggregate ag={data.aggregate} />
          <div style={{ fontSize: 11, letterSpacing: 1, margin: '4px 0 8px', ...muted }}>YOUR PAPER TRADES ({data.trades.length} explained of {data.closedTrades} closed)</div>
          {data.trades.map((t) => <TradeCard key={t.id} t={t} />)}
          {data.skipped.length ? (
            <div style={{ ...card, fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Not explained yet ({data.skipped.length})</div>
              {data.skipped.map((s) => <div key={s.id} style={muted}>{s.symbol} {s.date}: {s.reason}</div>)}
              <div style={{ fontSize: 11, marginTop: 6, ...muted }}>Candles are recorded by the movers script (data/movers/5m); re-run it after the market day and refresh.</div>
            </div>
          ) : null}
          {data.samples?.length ? (
            <>
              <div style={{ fontSize: 11, letterSpacing: 1, margin: '18px 0 4px', ...muted }}>EXAMPLES FROM THE SIMULATION (replayed history, not your trades)</div>
              <div style={{ fontSize: 12, margin: '0 0 8px', ...muted }}>One real replayed trade per loss cause plus a winner, so you can see how each kind of trade looks on the chart.</div>
              {data.samples.map((t) => <TradeCard key={t.id} t={t} />)}
            </>
          ) : null}
          {!data.trades.length && !data.skipped.length ? <div style={muted}>No closed paper trades yet.</div> : null}
        </>
      )}
    </main>
  );
}
