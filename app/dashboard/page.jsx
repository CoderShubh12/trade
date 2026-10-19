'use client';
// /dashboard : progress to the "100 paper trades" gate. Reads /api/journal only (real live paper trades; replay is refused server-side).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

const RISK = 500, SLIP = 0.0003;
const GATE = { n: 100, pf: 1.3 };

// Net R after estimated costs: Rs 40 + 0.035% of notional, plus 0.03% slippage on each side (same convention as the backtests).
function netR(t) {
  const sl = Number(t.initialSl) || Number(t.stopLoss);
  const risk = Math.abs(t.entry - sl);
  if (!(risk > 0) || !Number.isFinite(t.r)) return t.r;
  const qty = Math.min(RISK / risk, 500000 / t.entry);
  const notional = qty * t.entry;
  const cost = 40 + 0.00035 * notional + 2 * SLIP * notional;
  return t.r - cost / RISK;
}
const stats = (arr) => {
  const n = arr.length;
  if (!n) return { n: 0, win: 0, pf: 0, net: 0, avg: 0, gross: 0 };
  const w = arr.filter((x) => x.nr > 0), l = arr.filter((x) => x.nr < 0);
  const sw = w.reduce((a, x) => a + x.nr, 0), sl = -l.reduce((a, x) => a + x.nr, 0);
  const net = arr.reduce((a, x) => a + x.nr, 0);
  return { n, win: (100 * w.length) / n, pf: sl > 0 ? sw / sl : sw > 0 ? Infinity : 0, net, avg: net / n, gross: arr.reduce((a, x) => a + x.r, 0) };
};
const fx = (v, d = 2) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(d) : '–');
const sgn = (v) => (v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-muted)');

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-muted)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Tile({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--bg-card-subtle)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-main)' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div> : null}
    </div>
  );
}
function Gate({ ok, label, detail }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-color)' }}>
      <span style={{ width: 20, height: 20, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: ok ? 'var(--accent-green)' : 'var(--border-color)', color: ok ? '#04140c' : 'var(--text-muted)' }}>{ok ? '✓' : '·'}</span>
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{detail}</span>
    </div>
  );
}
function Curve({ pts }) {
  if (pts.length < 2) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Curve needs at least 2 closed trades.</div>;
  const W = 600, H = 150, P = 6;
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), rng = hi - lo || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1), y = (v) => H - P - ((v - lo) * (H - 2 * P)) / rng;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }} role="img" aria-label="Cumulative R after costs">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--border-color)" strokeDasharray="4 4" />
      <path d={d} fill="none" stroke={last >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'} strokeWidth="2" />
    </svg>
  );
}
function Group({ title, rows }) {
  return (
    <Card title={title}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
            <th style={{ textAlign: 'left', padding: 4 }}>&nbsp;</th><th>n</th><th>Win%</th><th>PF</th><th>Net R</th><th>Net ₹</th>
          </tr></thead>
          <tbody>{rows.map(([k, s]) => (
            <tr key={k} style={{ textAlign: 'right', borderTop: '1px solid var(--border-color)' }}>
              <td style={{ textAlign: 'left', padding: 4 }}>{k}</td><td>{s.n}</td><td>{fx(s.win, 0)}</td><td>{fx(s.pf)}</td>
              <td style={{ color: sgn(s.net) }}>{fx(s.net)}</td><td style={{ color: sgn(s.net) }}>{Math.round(s.net * RISK).toLocaleString('en-IN')}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Card>
  );
}
const by = (arr, f) => {
  const m = new Map();
  arr.forEach((t) => { const k = f(t) || '–'; m.set(k, [...(m.get(k) || []), t]); });
  return [...m.entries()].map(([k, v]) => [k, stats(v)]).sort((a, b) => b[1].n - a[1].n);
};

export default function Hundred() {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState('');
  const [health, setHealth] = useState(null);
  const [picks, setPicks] = useState(null);
  useEffect(() => {
    let off = false;
    const load = () => fetch('/api/journal', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (!off) { setItems(j.items || []); setErr(''); } }).catch((e) => { if (!off) setErr(String(e.message || e)); });
    load();
    const t = setInterval(load, 30000);
    return () => { off = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let off = false;
    const load = () => fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (!off && j.success) setHealth(j); }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { off = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    let off = false;
    const load = () => fetch('/api/picks', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (!off && j.success) setPicks(j); }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { off = true; clearInterval(t); };
  }, []);

  const m = useMemo(() => {
    if (!items) return null;
    const sorted = [...items].sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
    const closed = sorted.filter((t) => t.exitPrice != null && Number.isFinite(t.r)).map((t) => ({ ...t, nr: netR(t) }));
    const open = sorted.length - closed.length;
    const all = stats(closed);
    const h = Math.floor(closed.length / 2);
    const a = stats(closed.slice(0, h)), b = stats(closed.slice(h));
    let c = 0;
    const curve = [0, ...closed.map((t) => (c += t.nr))];
    return { closed, open, all, a, b, curve, recent: [...closed].reverse().slice(0, 15) };
  }, [items]);

  if (err) return <main style={{ padding: 16 }}>Could not load the journal: {err}</main>;
  if (!m) return <main style={{ padding: 16, color: 'var(--text-muted)' }}>Loading…</main>;
  const { all, a, b, closed } = m;
  const enough = all.n >= GATE.n;
  const passPF = enough && all.pf >= GATE.pf;
  const passHalves = enough && a.net > 0 && b.net > 0;
  const pass = enough && passPF && passHalves;
  const pct = Math.min(100, (all.n / GATE.n) * 100);

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '16px 16px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 18 }}>100-Trade Paper Gate</h1>
        <Link href="/" style={{ color: 'var(--accent-blue)', fontSize: 13 }}>← Terminal</Link>
      </div>

      {health ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, fontSize: 12 }}>
          {[
            [`Feed ${health.health?.level || '?'}`, health.health?.level === 'ok' ? 'var(--accent-green)' : health.health?.level === 'degraded' ? 'var(--accent-yellow)' : 'var(--accent-red)', (health.health?.reasons || []).join(' · ')],
            [`Journal ${health.integrity?.ok ? 'ok' : 'ERRORS'}${health.integrity?.counts?.warn ? ` · ${health.integrity.counts.warn} warn` : ''}`, health.integrity?.ok ? 'var(--accent-green)' : 'var(--accent-red)', (health.integrity?.issues || []).slice(0, 3).map((i) => `${i.code} ${i.symbol}`).join(' · ')],
            [`Backups ${health.backup?.count ?? 0}`, (health.backup?.count || 0) > 0 ? 'var(--accent-green)' : 'var(--accent-yellow)', health.backup?.latest?.['paper-journal'] || 'none yet'],
          ].map(([label, color, tip]) => (
            <span key={label} title={tip} style={{ padding: '3px 10px', borderRadius: 12, border: `1px solid ${color}`, color }}>{label}</span>
          ))}
        </div>
      ) : null}

      <Card title="TODAY'S PICKS AND TRADES (research view, not signals)">
        {(() => {
          const day = picks?.day;
          const todays = (items || []).filter((t) => t.dateStr === day).sort((x, y) => (parseInt(x.id, 10) || 0) - (parseInt(y.id, 10) || 0));
          const last = (picks?.snaps || []).filter((x) => x.picks.length).slice(-1)[0];
          const ev = picks?.evals || [];
          const mean = (k) => (ev.length ? ev.reduce((a, e) => a + (e[k] || 0), 0) / ev.length : null);
          return (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Latest 15-min picks (relative move vs Nifty){last ? ` at ${last.clock}` : ''}: ▲ = moving up, ▼ = moving down</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {last ? last.picks.map((p) => (<span key={p.n} style={{ padding: '3px 10px', borderRadius: 12, border: '1px solid var(--border-color)', color: p.dir > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{p.n} {p.dir > 0 ? '▲' : '▼'} {fx(p.rs)}%</span>)) : <span style={{ color: 'var(--text-muted)' }}>No picks logged yet today.</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Picks result after 15 min, before costs ({ev.length} slots): picks {mean('picksFwd') == null ? '–' : fx(mean('picksFwd'), 3) + '%'} vs all watched stocks {mean('allFwd') == null ? '–' : fx(mean('allFwd'), 3) + '%'}. Costs are about 0.10%, so this is not an edge.
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Trades today ({todays.length})</div>
              {todays.length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}><th style={{ textAlign: 'left' }}>Time</th><th style={{ textAlign: 'left' }}>Stock</th><th>Side</th><th>In</th><th>Out</th><th style={{ textAlign: 'left', paddingLeft: 8 }}>Why</th><th>R (gross)</th></tr></thead>
                  <tbody>{todays.map((t) => (<tr key={t.id} style={{ textAlign: 'right', borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ textAlign: 'left' }}>{t.entryClock}</td><td style={{ textAlign: 'left' }}>{t.symbol}</td><td>{t.side}</td><td>{fx(t.entry)}</td><td>{t.exitPrice != null ? fx(t.exitPrice) : 'open'}</td>
                    <td style={{ textAlign: 'left', paddingLeft: 8 }}>{t.source === 'engine' ? '[engine] ' : ''}{t.reason || ''}</td><td style={{ color: sgn(t.r) }}>{Number.isFinite(t.r) ? fx(t.r) : '–'}</td></tr>))}</tbody>
                </table>
              ) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No trades today yet.</span>}
            </div>
          );
        })()}
      </Card>

      <Card title="PROGRESS">
        <div style={{ fontSize: 28, fontWeight: 700 }}>{all.n} <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/ {GATE.n} closed paper trades</span></div>
        <div style={{ height: 8, background: 'var(--border-color)', borderRadius: 4, margin: '8px 0' }}>
          <div style={{ width: `${pct}%`, height: 8, borderRadius: 4, background: pass ? 'var(--accent-green)' : 'var(--accent-blue)' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.open} open · {Math.max(0, GATE.n - all.n)} more needed</div>
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, fontSize: 13, background: 'var(--bg-card-subtle)', color: pass ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
          {pass ? 'Gate passed on paper. Still not proof for real money; keep the sample growing.'
            : !enough ? `Too few trades to conclude anything (${all.n}/${GATE.n}). Numbers below are noise until the gate is reached.`
            : 'Gate NOT passed. Do not trade real money with this strategy.'}
        </div>
      </Card>

      <Card title="ALL CLOSED TRADES (after estimated costs)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
          <Tile label="Win rate" value={`${fx(all.win, 0)}%`} sub="alone is misleading" />
          <Tile label="Profit factor" value={fx(all.pf)} color={sgn(all.pf - 1)} sub={`need ≥ ${GATE.pf}`} />
          <Tile label="Net R" value={fx(all.net)} color={sgn(all.net)} sub={`gross ${fx(all.gross)}R`} />
          <Tile label="Net ₹" value={Math.round(all.net * RISK).toLocaleString('en-IN')} color={sgn(all.net)} sub={`₹${RISK}/R`} />
          <Tile label="Avg per trade" value={`${fx(all.avg, 3)}R`} color={sgn(all.avg)} />
        </div>
      </Card>

      <Card title="GATE CHECKLIST">
        <Gate ok={enough} label={`At least ${GATE.n} closed trades`} detail={`${all.n}/${GATE.n}`} />
        <Gate ok={passPF} label={`Profit factor ≥ ${GATE.pf} after costs`} detail={enough ? fx(all.pf) : 'waiting'} />
        <Gate ok={passHalves} label="Net positive in BOTH halves (older / newer)" detail={enough ? `${fx(a.net)}R / ${fx(b.net)}R` : 'waiting'} />
      </Card>

      <Card title="CUMULATIVE R (after costs)"><Curve pts={m.curve} /></Card>

      <Group title="BY SOURCE" rows={by(closed, (t) => t.source || 'page')} />
      <Group title="BY SIDE" rows={by(closed, (t) => t.side)} />
      <Group title="BY TIMEFRAME" rows={by(closed, (t) => `${t.timeframe || '5'}m`)} />
      <Group title="BY STOCK" rows={by(closed, (t) => t.symbol)} />

      <Card title="LAST 15 CLOSED">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
              <th style={{ textAlign: 'left' }}>Day</th><th style={{ textAlign: 'left' }}>Stock</th><th>Side</th><th>In</th><th>Out</th><th style={{ textAlign: 'left', paddingLeft: 8 }}>Why</th><th>Net R</th>
            </tr></thead>
            <tbody>{m.recent.map((t) => (
              <tr key={t.id} style={{ textAlign: 'right', borderTop: '1px solid var(--border-color)' }}>
                <td style={{ textAlign: 'left' }}>{t.dateStr} {t.entryClock}</td><td style={{ textAlign: 'left' }}>{t.symbol}</td><td>{t.side}</td>
                <td>{fx(t.entry)}</td><td>{fx(t.exitPrice)}</td><td style={{ textAlign: 'left', paddingLeft: 8 }}>{t.reason}</td>
                <td style={{ color: sgn(t.nr) }}>{fx(t.nr)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Card>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Costs: ₹40 + 0.035% notional + 0.03% slippage each side (same as the backtests). Only live paper trades appear here; replay is refused by the journal.</div>
    </main>
  );
}
