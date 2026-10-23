"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// Builds an SVG path from an array of values (null/NaN = gap).
function buildPath(points, xOf, yOf) {
  if (!points || points.length <= 1) return "";
  let d = "";
  let pending = true;
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (v === null || v === undefined || isNaN(v)) {
      pending = true;
      continue;
    }
    d += `${pending ? "M" : "L"} ${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
    pending = false;
  }
  return d;
}

// Nice round step for the price grid (0.5, 1, 2, 5, 10 ...).
function niceStep(range, targetLines) {
  const raw = range / Math.max(1, targetLines);
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow;
  const f = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return f * pow;
}

const RIGHT_AXIS = 62; // room for price labels
const BOTTOM_AXIS = 20; // room for time labels
const PAD_TOP = 10;

/**
 * Candlestick chart (plain SVG, no library).
 *  - width follows its container, height comes from the `height` prop
 *  - price axis, time axis, crosshair with OHLC read-out
 *  - optional trade levels (entry / stop / targets) drawn as lines
 */
export default function PriceChart({
  data = [],
  ind = {},
  score = 0,
  height = 420,
  visibleBars = 90,
  levels = null, // { entry, stopLoss, target1, target2, side }
  markers = null, // [{key:'YYYY-MM-DD HH:MM', side:'BUY'|'SELL', rule, why, price, afterPct}] rule-trigger points
  breach = null, // research: { level, side, label } breached ORB level line
}) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(900);
  const [hoverIdx, setHoverIdx] = useState(null);

  // Follow the container width
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (!data || data.length === 0) return null;

    const start = Math.max(0, data.length - visibleBars);
    const bars = data.slice(start);
    const e9 = ind?.ema9 ? ind.ema9.slice(start) : [];
    const e21 = ind?.ema21 ? ind.ema21.slice(start) : [];
    const vw = ind?.vwap ? ind.vwap.slice(start) : [];

    const volH = Math.round(height * 0.16);
    const plotW = width - RIGHT_AXIS - 6;
    const priceH = height - PAD_TOP - BOTTOM_AXIS - volH - 8;

    const prices = [];
    bars.forEach((b) => {
      if (b.high > 0) prices.push(b.high);
      if (b.low > 0) prices.push(b.low);
    });
    [...e9, ...e21, ...vw].forEach((v) => {
      if (v > 0) prices.push(v);
    });
    if (levels) {
      [levels.entry, levels.stopLoss, levels.target1, levels.target2].forEach(
        (v) => {
          if (v > 0) prices.push(v);
        },
      );
    }
    if (prices.length === 0) return null;

    let minY = Math.min(...prices);
    let maxY = Math.max(...prices);
    const padY = (maxY - minY || 1) * 0.06;
    minY -= padY;
    maxY += padY;

    const n = bars.length;
    const xStep = plotW / Math.max(1, n);
    const xOf = (i) => xStep * (i + 0.5);
    const yOf = (v) => PAD_TOP + priceH - ((v - minY) / (maxY - minY)) * priceH;
    const candleW = Math.max(2, Math.min(14, xStep * 0.7));

    // price grid
    const step = niceStep(maxY - minY, Math.max(3, Math.floor(priceH / 55)));
    const grid = [];
    for (let p = Math.ceil(minY / step) * step; p <= maxY; p += step) {
      grid.push({ p, y: yOf(p) });
    }

    // time labels (about one every 90px, on bars that have a clock)
    const every = Math.max(1, Math.round(90 / xStep));
    const times = [];
    bars.forEach((b, i) => {
      if (i % every === 0 && b.clock) times.push({ x: xOf(i), t: b.clock });
    });

    // new trading day separators
    const dayBreaks = [];
    for (let i = 1; i < n; i++) {
      if (bars[i].date && bars[i - 1].date && bars[i].date !== bars[i - 1].date) {
        dayBreaks.push(xOf(i) - xStep / 2);
      }
    }

    const maxVol = Math.max(...bars.map((b) => b.volume || 1), 1);
    const volTop = PAD_TOP + priceH + 8;
    const volSma = bars.map((_, i) => {
      const w = bars.slice(Math.max(0, i - 19), i + 1);
      return w.reduce((s, b) => s + (b.volume || 1), 0) / w.length;
    });

    const candles = bars.map((b, i) => {
      const bull = b.close >= b.open;
      const vol = b.volume || 1;
      const surge = vol > volSma[i] * 1.5;
      return {
        x: xOf(i),
        yH: yOf(b.high),
        yL: yOf(b.low),
        top: yOf(Math.max(b.open, b.close)),
        h: Math.max(1.5, Math.abs(yOf(b.open) - yOf(b.close))),
        color: bull ? "#2FD98A" : "#FF5D5D",
        volY: volTop + volH - (vol / maxVol) * (volH - 4),
        volH: Math.max(1.5, (vol / maxVol) * (volH - 4)),
        volColor: surge
          ? bull
            ? "rgba(47,217,138,0.75)"
            : "rgba(255,93,93,0.75)"
          : bull
            ? "rgba(47,217,138,0.25)"
            : "rgba(255,93,93,0.25)",
      };
    });

    const mk = [];
    if (markers && markers.length) {
      const idx = new Map(bars.map((b, i) => [`${b.date} ${b.clock}`, i]));
      for (const m of markers) { const i = idx.get(m.key); if (i == null) continue; const b = bars[i]; mk.push({ ...m, x: xOf(i), y: m.side === "BUY" ? yOf(b.low) + 12 : yOf(b.high) - 12 }); }
    }

    let cpr = null;
    if (ind?.cpr) {
      const yTC = yOf(ind.cpr.tc);
      const yBC = yOf(ind.cpr.bc);
      cpr = {
        y: Math.min(yTC, yBC),
        h: Math.max(2, Math.abs(yBC - yTC)),
        yP: yOf(ind.cpr.pivot),
      };
    }
    let orb = null;
    if (ind?.orHigh && ind?.orLow) {
      const a = yOf(ind.orHigh);
      const b = yOf(ind.orLow);
      orb = { y: Math.min(a, b), h: Math.max(2, Math.abs(a - b)) };
    }

    return {
      bars,
      candles,
      grid,
      times,
      dayBreaks,
      xStep,
      xOf,
      yOf,
      plotW,
      priceH,
      volTop,
      volH,
      candleW,
      cpr,
      mk,
      orb,
      e9D: buildPath(e9, xOf, yOf),
      e21D: buildPath(e21, xOf, yOf),
      vwD: buildPath(vw, xOf, yOf),
      volSmaD: buildPath(volSma, xOf, (v) => volTop + volH - (v / maxVol) * (volH - 4)),
    };
  }, [data, ind, width, height, visibleBars, levels, markers]);

  if (!chart) {
    return (
      <div
        ref={boxRef}
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#7b8395",
          fontSize: "0.85rem",
        }}
      >
        Connecting to feed & generating candle structure…
      </div>
    );
  }

  const zoneColor = score >= 65 ? "#2FD98A" : score <= -65 ? "#FF5D5D" : null;
  const last = chart.candles[chart.candles.length - 1];
  const lastBar = chart.bars[chart.bars.length - 1];
  const hb = hoverIdx !== null ? chart.bars[hoverIdx] : null;

  const onMove = (e) => {
    const rect = boxRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor(x / chart.xStep);
    setHoverIdx(i >= 0 && i < chart.bars.length ? i : null);
  };

  const levelLines = (levels
    ? [
        { v: levels.entry, c: "#e2e8f0", t: `ENTRY ${levels.side || ""}` },
        { v: levels.stopLoss, c: "#FF5D5D", t: "STOP" },
        { v: levels.target1, c: "#2FD98A", t: "T1" },
        { v: levels.target2, c: "#22c55e", t: "T2" },
      ].filter((l) => l.v > 0)
    : []).concat(breach && breach.level > 0 ? [{ v: breach.level, c: "#f59e0b", t: breach.label || "BREACH" }] : []);

  return (
    <div
      ref={boxRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
      style={{
        width: "100%",
        height,
        position: "relative",
        borderRadius: 8,
        background: "#080c14",
        border: zoneColor ? `2px solid ${zoneColor}` : "1px solid #1a2333",
        boxShadow: zoneColor ? `0 0 14px ${zoneColor}55` : "none",
        overflow: "hidden",
      }}
    >
      {zoneColor && (
        <div
          style={{
            position: "absolute",
            bottom: height * 0.16 + 34, // sits above the volume strip, clear of the OHLC read-out
            left: 10,
            zIndex: 5,
            padding: "2px 9px",
            borderRadius: 4,
            fontSize: "0.68rem",
            fontWeight: 800,
            color: zoneColor,
            border: `1px solid ${zoneColor}`,
            background: `${zoneColor}22`,
          }}
        >
          {score >= 65 ? "BUY ZONE" : "SELL ZONE"}
        </div>
      )}

      {/* OHLC read-out (hover, else latest bar) */}
      {(() => {
        const b = hb || lastBar;
        if (!b) return null;
        return (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 10,
              zIndex: 5,
              fontFamily: "monospace",
              fontSize: "0.72rem",
              color: "#cbd5e1",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              pointerEvents: "none",
            }}
          >
            <span style={{ color: "#94a3b8" }}>
              {b.date ? `${b.date} ` : ""}
              {b.clock || ""}
            </span>
            <span>O {b.open?.toFixed(2)}</span>
            <span>H {b.high?.toFixed(2)}</span>
            <span>L {b.low?.toFixed(2)}</span>
            <span style={{ color: b.close >= b.open ? "#2FD98A" : "#FF5D5D" }}>
              C {b.close?.toFixed(2)}
            </span>
            <span style={{ color: "#94a3b8" }}>
              V {Number(b.volume || 0).toLocaleString("en-IN")}
            </span>
          </div>
        );
      })()}

      <svg width={width} height={height} style={{ display: "block" }}>
        {/* CPR + ORB zones */}
        {chart.cpr && (
          <g>
            <rect
              x={0}
              y={chart.cpr.y}
              width={chart.plotW}
              height={chart.cpr.h}
              fill="rgba(180,110,255,0.06)"
              stroke="rgba(180,110,255,0.25)"
              strokeDasharray="2,2"
            />
            <line
              x1={0}
              x2={chart.plotW}
              y1={chart.cpr.yP}
              y2={chart.cpr.yP}
              stroke="rgba(180,110,255,0.5)"
              strokeDasharray="4,4"
            />
          </g>
        )}
        {chart.orb && (
          <rect
            x={0}
            y={chart.orb.y}
            width={chart.plotW}
            height={chart.orb.h}
            fill="rgba(91,140,255,0.05)"
            stroke="rgba(91,140,255,0.2)"
            strokeDasharray="3,3"
          />
        )}

        {/* price grid + labels */}
        {chart.grid.map((g, i) => (
          <g key={`g${i}`}>
            <line
              x1={0}
              x2={chart.plotW}
              y1={g.y}
              y2={g.y}
              stroke="#141c2b"
            />
            <text
              x={chart.plotW + 6}
              y={g.y + 3}
              fill="#64748b"
              fontSize="10"
              fontFamily="monospace"
            >
              {g.p.toFixed(2)}
            </text>
          </g>
        ))}

        {/* new-day separators */}
        {chart.dayBreaks.map((x, i) => (
          <line
            key={`d${i}`}
            x1={x}
            x2={x}
            y1={PAD_TOP}
            y2={chart.volTop + chart.volH}
            stroke="#334155"
            strokeDasharray="3,3"
          />
        ))}

        {/* volume */}
        {chart.candles.map((c, i) => (
          <rect
            key={`v${i}`}
            x={c.x - chart.candleW / 2}
            y={c.volY}
            width={chart.candleW}
            height={c.volH}
            fill={c.volColor}
          />
        ))}
        {chart.volSmaD && (
          <path
            d={chart.volSmaD}
            fill="none"
            stroke="#f97316"
            strokeWidth="1"
            strokeDasharray="3,2"
            opacity="0.75"
          />
        )}
        <text
          x={2}
          y={chart.volTop + 10}
          fill="#475569"
          fontSize="9"
          fontWeight="700"
        >
          VOLUME
        </text>

        {/* lines */}
        {chart.vwD && (
          <path
            d={chart.vwD}
            fill="none"
            stroke="#F5B841"
            strokeWidth="1.5"
            strokeDasharray="4,3"
          />
        )}
        {chart.e21D && (
          <path
            d={chart.e21D}
            fill="none"
            stroke="#8B93A3"
            strokeWidth="1.2"
            opacity="0.8"
          />
        )}
        {chart.e9D && (
          <path d={chart.e9D} fill="none" stroke="#5B8CFF" strokeWidth="1.5" />
        )}

        {/* candles */}
        {chart.candles.map((c, i) => (
          <g key={`c${i}`}>
            <line
              x1={c.x}
              x2={c.x}
              y1={c.yH}
              y2={c.yL}
              stroke={c.color}
              strokeWidth="1.2"
            />
            <rect
              x={c.x - chart.candleW / 2}
              y={c.top}
              width={chart.candleW}
              height={c.h}
              fill={c.color}
            />
          </g>
        ))}

        {/* rule-trigger points (buy / sell) */}
        {chart.mk.map((m, i) => {
          const col = m.side === "BUY" ? "#2FD98A" : "#FF5D5D";
          const tri = m.side === "BUY" ? `${m.x},${m.y - 7} ${m.x - 6},${m.y + 5} ${m.x + 6},${m.y + 5}` : `${m.x},${m.y + 7} ${m.x - 6},${m.y - 5} ${m.x + 6},${m.y - 5}`;
          return (
            <g key={`mk${i}`}>
              <title>{`${m.side} trigger (${m.rule}) @ ${m.price}: ${m.why}${m.afterPct == null ? "" : `. Next 5 bars: ${m.afterPct > 0 ? "+" : ""}${m.afterPct}% in this direction`}`}</title>
              <polygon points={tri} fill={col} stroke="#0b1220" strokeWidth="1" />
              <text x={m.x} y={m.side === "BUY" ? m.y + 17 : m.y - 9} fontSize="8" fill={col} textAnchor="middle" fontWeight="700">{m.rule}</text>
            </g>
          );
        })}

        {/* trade levels */}
        {levelLines.map((l, i) => {
          const y = chart.yOf(l.v);
          return (
            <g key={`l${i}`}>
              <line
                x1={0}
                x2={chart.plotW}
                y1={y}
                y2={y}
                stroke={l.c}
                strokeWidth="1"
                strokeDasharray="6,4"
                opacity="0.85"
              />
              <rect
                x={chart.plotW + 2}
                y={y - 8}
                width={RIGHT_AXIS}
                height={16}
                rx={3}
                fill={l.c}
              />
              <text
                x={chart.plotW + 2 + RIGHT_AXIS / 2}
                y={y + 3.5}
                fill="#020617"
                fontSize="9"
                fontWeight="800"
                textAnchor="middle"
              >
                {l.t}
              </text>
              <text
                x={6}
                y={y - 3}
                fill={l.c}
                fontSize="9"
                fontFamily="monospace"
              >
                {l.t} {l.v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* live price tag */}
        {last && lastBar && (
          <g>
            <line
              x1={0}
              x2={chart.plotW}
              y1={chart.yOf(lastBar.close)}
              y2={chart.yOf(lastBar.close)}
              stroke={last.color}
              strokeDasharray="3,2"
              opacity="0.7"
            />
            <rect
              x={chart.plotW + 2}
              y={chart.yOf(lastBar.close) - 8}
              width={RIGHT_AXIS}
              height={16}
              rx={3}
              fill={last.color}
            />
            <text
              x={chart.plotW + 2 + RIGHT_AXIS / 2}
              y={chart.yOf(lastBar.close) + 3.5}
              fill="#000"
              fontSize="10"
              fontWeight="800"
              textAnchor="middle"
            >
              {Number(lastBar.close).toFixed(2)}
            </text>
          </g>
        )}

        {/* time axis */}
        {chart.times.map((t, i) => (
          <text
            key={`t${i}`}
            x={t.x}
            y={height - 5}
            fill="#64748b"
            fontSize="10"
            textAnchor="middle"
          >
            {t.t}
          </text>
        ))}

        {/* crosshair */}
        {hoverIdx !== null && (
          <line
            x1={chart.xOf(hoverIdx)}
            x2={chart.xOf(hoverIdx)}
            y1={PAD_TOP}
            y2={chart.volTop + chart.volH}
            stroke="#94a3b8"
            strokeDasharray="2,3"
            opacity="0.6"
          />
        )}
      </svg>
    </div>
  );
}
