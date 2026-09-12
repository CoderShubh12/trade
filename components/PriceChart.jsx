"use client";

import { useMemo } from "react";

function buildPath(points, chartW, chartH, minY, maxY) {
  if (!points || points.length <= 1) return "";
  const range = maxY - minY || 1;
  const xStep = chartW / Math.max(1, points.length - 1);
  let d = "";
  let isPending = true;

  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (v === null || v === undefined || isNaN(v)) {
      isPending = true;
      continue;
    }
    const x = i * xStep;
    const y = chartH - ((v - minY) / range) * chartH;
    if (isPending) {
      d += `M ${x.toFixed(1)},${y.toFixed(1)}`;
      isPending = false;
    } else {
      d += ` L ${x.toFixed(1)},${y.toFixed(1)}`;
    }
  }
  return d;
}

export default function PriceChart({ data = [], ind = {}, score = 0 }) {
  const chart = useMemo(() => {
    const w = 920;
    const h = 340;
    const pad = 14;
    const rightMargin = 55; // Price label space on the right
    const volHeight = 55;
    const priceH = h - pad * 2 - volHeight;
    const innerW = w - pad * 2 - rightMargin;

    if (!data || data.length === 0) {
      return {
        w,
        h,
        pad,
        innerW,
        rightMargin,
        priceH,
        candles: [],
        volBars: [],
        hasData: false,
      };
    }

    const start = Math.max(0, data.length - 75);
    const viewBars = data.slice(start);

    const e9 = ind?.ema9 ? ind.ema9.slice(start) : [];
    const e21 = ind?.ema21 ? ind.ema21.slice(start) : [];
    const vw = ind?.vwap ? ind.vwap.slice(start) : [];

    const highs = viewBars.map((d) => d.high).filter((v) => !isNaN(v) && v > 0);
    const lows = viewBars.map((d) => d.low).filter((v) => !isNaN(v) && v > 0);
    const volumes = viewBars.map((d) => d.volume || 1);

    const allPrices = [...highs, ...lows, ...e9, ...e21, ...vw].filter(
      (v) => v !== null && v !== undefined && !isNaN(v) && v > 0,
    );

    if (allPrices.length === 0) {
      return {
        w,
        h,
        pad,
        innerW,
        rightMargin,
        priceH,
        candles: [],
        volBars: [],
        hasData: false,
      };
    }

    let minY = Math.min(...allPrices) * 0.999;
    let maxY = Math.max(...allPrices) * 1.001;
    if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    }

    const maxVol = Math.max(...volumes, 1);
    const xStep = innerW / Math.max(1, viewBars.length - 1);
    const candleWidth = Math.max(3.5, Math.min(8.5, xStep * 0.65));

    // Calculate 20-Period Volume SMA
    const volSma = [];
    for (let i = 0; i < viewBars.length; i++) {
      const sliceStart = Math.max(0, i - 19);
      const window = viewBars.slice(sliceStart, i + 1);
      const avg =
        window.reduce((sum, b) => sum + (b.volume || 1), 0) / window.length;
      volSma.push(avg);
    }

    // Candlesticks mapping
    const candles = viewBars.map((d, i) => {
      const x = i * xStep;
      const yHigh = priceH - ((d.high - minY) / (maxY - minY)) * priceH;
      const yLow = priceH - ((d.low - minY) / (maxY - minY)) * priceH;
      const yOpen = priceH - ((d.open - minY) / (maxY - minY)) * priceH;
      const yClose = priceH - ((d.close - minY) / (maxY - minY)) * priceH;
      const isBull = d.close >= d.open;

      return {
        x,
        rawClose: d.close,
        yHigh: isNaN(yHigh) ? 0 : yHigh,
        yLow: isNaN(yLow) ? 0 : yLow,
        yClose: isNaN(yClose) ? 0 : yClose,
        top: isNaN(Math.min(yOpen, yClose)) ? 0 : Math.min(yOpen, yClose),
        height: Math.max(2, Math.abs(yClose - yOpen)),
        color: isBull ? "#2FD98A" : "#FF5D5D",
      };
    });

    // Volume Bars mapping
    const volBars = viewBars.map((d, i) => {
      const x = i * xStep;
      const barH = ((d.volume || 1) / maxVol) * (volHeight - 12);
      const isSurge = (d.volume || 1) > (volSma[i] || 1) * 1.5;
      const isBull = d.close >= d.open;

      const color = isSurge
        ? isBull
          ? "rgba(47, 217, 138, 0.75)"
          : "rgba(255, 93, 93, 0.75)"
        : isBull
          ? "rgba(47, 217, 138, 0.25)"
          : "rgba(255, 93, 93, 0.25)";

      return {
        x,
        y: h - pad * 2 - barH,
        height: Math.max(2, barH),
        color,
      };
    });

    const volSmaPath = buildPath(volSma, innerW, volHeight - 12, 0, maxVol);

    // CPR Levels
    let cprLevels = null;
    if (ind?.cpr) {
      const { tc, bc, pivot } = ind.cpr;
      const yTC = priceH - ((tc - minY) / (maxY - minY)) * priceH;
      const yBC = priceH - ((bc - minY) / (maxY - minY)) * priceH;
      const yP = priceH - ((pivot - minY) / (maxY - minY)) * priceH;
      cprLevels = {
        yTop: Math.min(yTC, yBC),
        height: Math.max(2, Math.abs(yBC - yTC)),
        yPivot: yP,
      };
    }

    // Opening Range Shading
    let orBand = null;
    if (ind?.orHigh && ind?.orLow) {
      const yHigh = priceH - ((ind.orHigh - minY) / (maxY - minY)) * priceH;
      const yLow = priceH - ((ind.orLow - minY) / (maxY - minY)) * priceH;
      orBand = {
        y: Math.min(yHigh, yLow),
        height: Math.max(2, Math.abs(yLow - yHigh)),
      };
    }

    return {
      w,
      h,
      pad,
      innerW,
      rightMargin,
      priceH,
      volHeight,
      candleWidth,
      candles,
      volBars,
      volSmaPath,
      lastCandle: candles[candles.length - 1] || null,
      e9D: buildPath(e9, innerW, priceH, minY, maxY),
      e21D: buildPath(e21, innerW, priceH, minY, maxY),
      vwD: buildPath(vw, innerW, priceH, minY, maxY),
      orBand,
      cprLevels,
      hasData: true,
    };
  }, [data, ind]);

  if (!chart.hasData) {
    return (
      <div
        style={{
          height: "340px",
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

  const isBuyZone = score >= 65;
  const isSellZone = score <= -65;
  const activeZoneColor = isBuyZone ? "#2FD98A" : isSellZone ? "#FF5D5D" : null;

  return (
    <div
      style={{
        width: "100%",
        height: "340px",
        position: "relative",
        borderRadius: "8px",
        background: "#080c14",
        border: activeZoneColor
          ? `2px solid ${activeZoneColor}`
          : "1px solid #1a2333",
        boxShadow: activeZoneColor
          ? `0 0 12px ${activeZoneColor}80, 0 0 24px ${activeZoneColor}30`
          : "none",
        animation: activeZoneColor
          ? "neonBorderPulse 1.5s ease-in-out infinite alternate"
          : "none",
        transition: "all 0.3s ease",
      }}
    >
      {activeZoneColor && (
        <style>{`
          @keyframes neonBorderPulse {
            0% {
              border-color: ${activeZoneColor};
              box-shadow: 0 0 8px ${activeZoneColor}60, 0 0 16px ${activeZoneColor}20;
            }
            100% {
              border-color: #ffffff;
              box-shadow: 0 0 16px ${activeZoneColor}, 0 0 32px ${activeZoneColor}50;
            }
          }
        `}</style>
      )}

      {/* Top Status Badge */}
      {activeZoneColor && (
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "12px",
            zIndex: 10,
            background: isBuyZone
              ? "rgba(47, 217, 138, 0.15)"
              : "rgba(255, 93, 93, 0.15)",
            border: `1px solid ${activeZoneColor}`,
            color: activeZoneColor,
            padding: "3px 10px",
            borderRadius: "4px",
            fontSize: "0.7rem",
            fontWeight: "700",
            letterSpacing: "0.04em",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: activeZoneColor,
            }}
          />
          {isBuyZone ? "BUY ZONE ACTIVE" : "SELL ZONE ACTIVE"}
        </div>
      )}

      {/* Main SVG Engine */}
      <svg
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        <g transform={`translate(${chart.pad}, ${chart.pad})`}>
          {/* CPR Band */}
          {chart.cprLevels && (
            <g>
              <rect
                x={0}
                y={chart.cprLevels.yTop}
                width={chart.innerW}
                height={chart.cprLevels.height}
                fill="rgba(180, 110, 255, 0.05)"
                stroke="rgba(180, 110, 255, 0.25)"
                strokeDasharray="2,2"
              />
              <line
                x1={0}
                y1={chart.cprLevels.yPivot}
                x2={chart.innerW}
                y2={chart.cprLevels.yPivot}
                stroke="rgba(180, 110, 255, 0.5)"
                strokeWidth="1"
                strokeDasharray="4,4"
              />
            </g>
          )}

          {/* ORB Zone */}
          {chart.orBand && (
            <rect
              x={0}
              y={chart.orBand.y}
              width={chart.innerW}
              height={chart.orBand.height}
              fill="rgba(91, 140, 255, 0.05)"
              stroke="rgba(91, 140, 255, 0.2)"
              strokeDasharray="3,3"
            />
          )}

          {/* Volume Baseline Divider */}
          <line
            x1={0}
            y1={chart.priceH + 4}
            x2={chart.innerW}
            y2={chart.priceH + 4}
            stroke="#1c2333"
            strokeWidth="1"
          />

          {/* Volume Sub-Label */}
          <text
            x={2}
            y={chart.priceH + 16}
            fill="#555d6e"
            fontSize="8"
            fontWeight="700"
            letterSpacing="0.05em"
          >
            VOL (20 SMA)
          </text>

          {/* Volume Bars */}
          {chart.volBars?.map((v, i) => (
            <rect
              key={`vol-${i}`}
              x={v.x - chart.candleWidth / 2}
              y={v.y}
              width={chart.candleWidth}
              height={v.height}
              fill={v.color}
            />
          ))}

          {/* Volume 20-SMA Trend Line */}
          {chart.volSmaPath && (
            <g
              transform={`translate(0, ${chart.h - chart.pad * 2 - (chart.volHeight - 12)})`}
            >
              <path
                d={chart.volSmaPath}
                fill="none"
                stroke="#f97316"
                strokeWidth="1.2"
                strokeDasharray="3,2"
                opacity="0.75"
              />
            </g>
          )}

          {/* Technical Moving Averages & VWAP */}
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
              opacity="0.7"
            />
          )}
          {chart.e9D && (
            <path
              d={chart.e9D}
              fill="none"
              stroke="#5B8CFF"
              strokeWidth="1.5"
            />
          )}

          {/* Candlesticks */}
          {chart.candles?.map((c, i) => (
            <g key={`candle-${i}`}>
              <line
                x1={c.x}
                y1={c.yHigh}
                x2={c.x}
                y2={c.yLow}
                stroke={c.color}
                strokeWidth="1.2"
              />
              <rect
                x={c.x - chart.candleWidth / 2}
                y={c.top}
                width={chart.candleWidth}
                height={c.height}
                fill={c.color}
              />
            </g>
          ))}

          {/* Live Price Horizontal Line, Marker Dot & LTP Price Tag */}
          {chart.lastCandle && (
            <g>
              {/* Horizontal Running Price Tracker Line */}
              <line
                x1={0}
                y1={chart.lastCandle.yClose}
                x2={chart.innerW}
                y2={chart.lastCandle.yClose}
                stroke={chart.lastCandle.color}
                strokeWidth="1"
                strokeDasharray="3,2"
                opacity="0.7"
              />

              {/* Pulsing Dot on Current Candle */}
              <circle
                cx={chart.lastCandle.x}
                cy={chart.lastCandle.yClose}
                r={3}
                fill={chart.lastCandle.color}
              />
              <circle
                cx={chart.lastCandle.x}
                cy={chart.lastCandle.yClose}
                r={6.5}
                fill="none"
                stroke={chart.lastCandle.color}
                strokeWidth="1"
                opacity="0.45"
              />

              {/* Live LTP Tag on Right Margin */}
              <g
                transform={`translate(${chart.innerW + 6}, ${chart.lastCandle.yClose - 8})`}
              >
                <rect
                  x={0}
                  y={0}
                  width={46}
                  height={16}
                  rx={3}
                  fill={chart.lastCandle.color}
                />
                <text
                  x={23}
                  y={11}
                  fill="#000000"
                  fontSize="9"
                  fontWeight="800"
                  textAnchor="middle"
                >
                  {chart.lastCandle.rawClose
                    ? Number(chart.lastCandle.rawClose).toFixed(2)
                    : ""}
                </text>
              </g>
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
