'use client';
// /research : the "research desk" for one stock. News, sentiment, credibility, impact, fundamentals and price movement,
// each from real data. The Chief line is rule-based context only; it is not a trade signal.
import { useEffect, useState } from 'react';
import Link from 'next/link';

const tone = (v) => (v > 0 ? 'var(--accent-green)' : v < 0 ? 'var(--accent-red)' : 'var(--text-muted)');
const n = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');

function Card({ title, role, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-muted)' }}>{title}</span>
        {role ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{role}</span> : null}
      </div>
      {children}
    </div>
  );
}
const Row = ({ k, v, c }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-color)', fontSize: 13 }}>
    <span style={{ color: 'var(--text-muted)' }}>{k}</span><span style={{ color: c || 'var(--text-main)' }}>{v}</span>
  </div>
);
const Off = ({ why }) => <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data: {why || 'unavailable'}</div>;

export default function Research() {
  const [list, setList] = useState([]);
  const [sel, setSel] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/watchlist', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const items = (j.items || []).filter((x) => x.symbol && x.token);
      setList(items);
      if (items[0]) setSel(items[0].symbol);
    }).catch(() => setErr('Watchlist could not be loaded'));
  }, []);

  const run = (symbol) => {
    const it = list.find((x) => x.symbol === symbol);
    if (!it) return;
    setBusy(true); setErr('');
    fetch(`/api/research?symbol=${encodeURIComponent(it.symbol)}&token=${encodeURIComponent(it.token)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error || 'failed'); setData(j); })
      .catch((e) => setErr(String(e.message || e))).finally(() => setBusy(false));
  };
  useEffect(() => { if (sel && list.length) run(sel); /* eslint-disable-next-line */ }, [sel, list.length]);

  const nw = data?.news, fu = data?.fundamentals, mv = data?.movement, ch = data?.chief;
  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '16px 16px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ fontSize: 18 }}>Research Bots</h1>
        <Link href="/" style={{ color: 'var(--accent-blue)', fontSize: 13 }}>← Terminal</Link>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ flex: 1, padding: 8, background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
          {list.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
        </select>
        <button onClick={() => run(sel)} disabled={busy || !sel} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' }}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      {err ? <div style={{ color: 'var(--accent-red)', marginBottom: 12, fontSize: 13 }}>{err}</div> : null}
      {!data ? <div style={{ color: 'var(--text-muted)' }}>{list.length ? 'Loading…' : 'Add stocks to your watchlist first.'}</div> : (
        <>
          <Card title="RESEARCH BOTS" role={`run ${new Date(data.asOf).toLocaleTimeString('en-IN')}`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10 }}>
              {(data.bots || []).map((b) => (
                <div key={b.id} style={{ background: 'var(--bg-card-subtle)', borderRadius: 8, padding: 10, borderLeft: `3px solid ${b.status === 'ok' ? 'var(--accent-green)' : 'var(--border-color)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
                    <span>{b.name}</span><span style={{ fontSize: 10, color: b.status === 'ok' ? 'var(--accent-green)' : 'var(--text-muted)' }}>{b.status.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 6px' }}>{b.role}</div>
                  <div style={{ fontSize: 13 }}>{b.verdict}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Source: {b.source}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="CHIEF MARKET INTELLIGENCE" role="rules, not AI">
            <div style={{ fontSize: 20, fontWeight: 700, color: ch.label.includes('BULL') ? 'var(--accent-green)' : ch.label.includes('BEAR') ? 'var(--accent-red)' : 'var(--accent-yellow)' }}>{ch.label}</div>
            {ch.flags.map((f) => <div key={f} style={{ fontSize: 13, color: 'var(--accent-yellow)', marginTop: 6 }}>⚠ {f}</div>)}
            {ch.pros.map((f) => <div key={f} style={{ fontSize: 13, color: 'var(--accent-green)', marginTop: 4 }}>+ {f}</div>)}
            {ch.cons.map((f) => <div key={f} style={{ fontSize: 13, color: 'var(--accent-red)', marginTop: 4 }}>− {f}</div>)}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>{ch.note}</div>
          </Card>

          <Card title="NEWS RESEARCH + SENTIMENT + CREDIBILITY + IMPACT" role="Google News → Groq tags">
            {!nw?.available ? <Off why={nw?.reason} /> : (
              <>
                <Row k="Sentiment (-1 to +1)" v={n(nw.sentiment)} c={tone(nw.sentiment)} />
                <Row k="Credibility (0 to 1)" v={nw.credibility == null ? '–' : n(nw.credibility)} c={nw.credibility != null && nw.credibility < 0.4 ? 'var(--accent-red)' : undefined} />
                <Row k="Distinct sources" v={nw.sources ?? '–'} />
                <Row k="Event risk" v={nw.eventRisk} c={nw.eventRisk === 'high' ? 'var(--accent-red)' : undefined} />
                <Row k="Impact" v={`${nw.impactScope || 'none'} · ${nw.impactHorizon || 'none'}`} />
                {nw.themes?.length ? <Row k="Themes" v={nw.themes.join(' · ')} /> : null}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 4px' }}>{nw.reason}</div>
              </>
            )}
            {(nw?.headlines || []).map((h) => <div key={h.title} style={{ fontSize: 12, padding: '3px 0' }}>• {h.title}{h.source ? <span style={{ color: 'var(--text-muted)' }}> — {h.source}</span> : null}</div>)}
          </Card>

          <Card title="FUNDAMENTAL RESEARCH" role="Yahoo Finance (unofficial)">
            {!fu?.available ? <Off why={fu?.reason} /> : (
              <>
                <div style={{ fontSize: 13, marginBottom: 6 }}>{fu.name} · {fu.sector || '–'}</div>
                <Row k="P/E" v={n(fu.pe, 1)} /><Row k="ROE %" v={n(fu.roe, 1)} />
                <Row k="Revenue growth %" v={n(fu.revenueGrowth, 1)} c={tone(fu.revenueGrowth)} />
                <Row k="Profit growth %" v={n(fu.earningsGrowth, 1)} c={tone(fu.earningsGrowth)} />
                {(fu.notes || []).map((x) => <div key={x.text} style={{ fontSize: 12, padding: '3px 0', color: x.tone === 'good' ? 'var(--accent-green)' : x.tone === 'bad' ? 'var(--accent-red)' : 'var(--text-muted)' }}>• {x.text}</div>)}
              </>
            )}
          </Card>

          <Card title="STOCK MOVEMENT" role="Angel One candles, 5m">
            {!mv?.available ? <Off why={mv?.reason} /> : (
              <>
                <Row k="Session / last candle" v={`${mv.session} ${mv.lastClock}${mv.stale ? ' (stale)' : ''}`} c={mv.stale ? 'var(--accent-red)' : undefined} />
                <Row k="Price" v={n(mv.price)} />
                <Row k="Day change %" v={n(mv.dayChangePct)} c={tone(mv.dayChangePct)} />
                <Row k="Gap at open %" v={n(mv.gapPct)} c={tone(mv.gapPct)} />
                <Row k="Position in day range" v={mv.rangePos == null ? '–' : `${mv.rangePos}%`} />
                <Row k="ATR % (volatility)" v={n(mv.atrPct)} />
                <Row k="VWAP side" v={mv.vwapSide || '–'} />
                <Row k="Volume vs previous session (same time)" v={mv.volVsYesterday == null ? '–' : `${n(mv.volVsYesterday)}x`} />
                <Row k="Terminal score" v={mv.score} c={tone(mv.score)} />
              </>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
