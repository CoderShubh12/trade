// components/FundamentalsPanel.jsx
// Fundamentals (Yahoo Finance, unofficial). Shown beside the chart, but it is
// NOT part of the intraday score: fundamentals do not move a 5-minute chart.
"use client";

import { useEffect, useState } from "react";

const crore = (v) => {
  if (v === null || v === undefined) return "—";
  const cr = v / 1e7; // 1 crore = 10 million
  return cr >= 1e5 ? `₹${(cr / 1e5).toFixed(2)} lakh cr` : `₹${Math.round(cr).toLocaleString("en-IN")} cr`;
};
const n = (v, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d));
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`);

const TONE = { good: "#2FD98A", bad: "#FF5D5D", neutral: "#94a3b8" };

function Row({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #111a2b" }}>
      <span style={{ color: "#94a3b8" }}>{k}</span>
      <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>{v}</span>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#60a5fa", letterSpacing: "0.05em", marginBottom: 2 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function FundamentalsPanel({ symbol, isIndex }) {
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!symbol || isIndex) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) =>
        setState(j.success ? { status: "ok", ...j } : { status: "error", error: j.error }),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setState({ status: "error", error: "Could not reach the fundamentals service." });
      });
    return () => ctrl.abort();
  }, [symbol, isIndex]);

  if (isIndex) {
    return <div style={{ color: "#64748b", fontSize: "0.78rem" }}>Fundamentals are for individual shares, not indices.</div>;
  }
  if (state.status === "loading") {
    return <div style={{ color: "#64748b", fontSize: "0.78rem" }}>Loading fundamentals for {symbol}…</div>;
  }
  if (state.status === "error") {
    return (
      <div style={{ color: "#fca5a5", fontSize: "0.78rem", lineHeight: 1.5 }}>
        {state.error}
        <div style={{ color: "#64748b", marginTop: 6 }}>
          No numbers are shown rather than guessed ones. You can check{" "}
          <a
            href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#60a5fa" }}
          >
            Screener.in
          </a>{" "}
          instead.
        </div>
      </div>
    );
  }
  if (state.status !== "ok") return null;

  const d = state.data;
  return (
    <div style={{ fontSize: "0.76rem", maxHeight: 520, overflowY: "auto", paddingRight: 4 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: "#f8fafc", fontWeight: 800 }}>{d.name || symbol}</div>
        <div style={{ color: "#64748b", fontSize: "0.68rem" }}>
          {[d.sector, d.industry].filter(Boolean).join(" · ") || "Sector not available"}
        </div>
      </div>

      {state.notes?.length > 0 && (
        <Group title="QUICK READ (rules of thumb, not advice)">
          {state.notes.map((x, i) => (
            <div key={i} style={{ color: TONE[x.tone], padding: "2px 0" }}>
              {x.tone === "good" ? "▲" : x.tone === "bad" ? "▼" : "•"} {x.text}
            </div>
          ))}
        </Group>
      )}

      <Group title="VALUATION">
        <Row k="Market cap" v={crore(d.marketCap)} />
        <Row k="P/E (trailing)" v={n(d.pe, 1)} />
        <Row k="P/E (forward)" v={n(d.forwardPe, 1)} />
        <Row k="Price / book" v={n(d.pb, 2)} />
        <Row k="EPS" v={d.eps === null ? "—" : `₹${n(d.eps, 2)}`} />
        <Row k="Dividend yield" v={pct(d.dividendYield)} />
      </Group>
      <Group title="PROFITABILITY">
        <Row k="ROE" v={pct(d.roe)} />
        <Row k="ROA" v={pct(d.roa)} />
        <Row k="Net margin" v={pct(d.profitMargin)} />
        <Row k="Operating margin" v={pct(d.operatingMargin)} />
      </Group>
      <Group title="GROWTH (latest quarter vs year ago)">
        <Row k="Revenue growth" v={pct(d.revenueGrowth)} />
        <Row k="Earnings growth" v={pct(d.earningsGrowth)} />
      </Group>
      <Group title="BALANCE SHEET">
        <Row k="Debt / equity" v={d.debtToEquity === null ? "—" : `${n(d.debtToEquity / 100, 2)}x`} />
        <Row k="Current ratio" v={n(d.currentRatio, 2)} />
        <Row k="Free cash flow" v={crore(d.freeCashflow)} />
      </Group>
      <Group title="PRICE RANGE & ANALYSTS">
        <Row k="52-week low" v={d.low52 === null ? "—" : `₹${n(d.low52, 2)}`} />
        <Row k="52-week high" v={d.high52 === null ? "—" : `₹${n(d.high52, 2)}`} />
        <Row k="Beta" v={n(d.beta, 2)} />
        <Row k="Analyst target (mean)" v={d.analystTarget === null ? "—" : `₹${n(d.analystTarget, 0)}`} />
        <Row k="Analyst view" v={d.analystRating ? `${d.analystRating} (${d.analystCount ?? "?"})` : "—"} />
      </Group>

      <div style={{ color: "#475569", fontSize: "0.64rem", lineHeight: 1.4 }}>
        Source: {state.source}
        {state.cached ? " · cached" : ""}
        {state.stale ? " · OLD copy, live fetch failed" : ""} · {new Date(state.fetchedAt).toLocaleString("en-IN")}.
        Values may be delayed or missing; verify before relying on them.
      </div>
    </div>
  );
}
