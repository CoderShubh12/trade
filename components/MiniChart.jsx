'use client';

import { useMemo } from 'react';

function buildPath(points, chartW, chartH, minY, maxY) {
  if (!points || points.length <= 1) return '';
  const range = maxY - minY || 1;
  const xStep = chartW / (points.length - 1);
  return points.reduce((d, v, i) => {
    if (v === null || isNaN(v)) return d;
    const x = i * xStep;
    const y = chartH - ((v - minY) / range) * chartH;
    return `${d}${d === '' ? 'M' : ' L'} ${x.toFixed(1)},${y.toFixed(1)}`;
  }, '');
}

export default function MiniChart({ values = [], color = '#5B8CFF', w = 180, h = 48, zeroLine, label }) {
  const svg = useMemo(() => {
    const pad = 6;
    const chartW = Math.max(0, w - pad * 2);
    const chartH = Math.max(0, h - pad * 2);
    if (!values || values.length === 0) return { d: '', zeroY: null };

    const start = Math.max(0, values.length - 100);
    const view = values.slice(start).map((v) => (v === null || isNaN(v) ? 0 : v));
    let minY = Math.min(...view);
    let maxY = Math.max(...view);

    if (zeroLine !== undefined) {
      minY = Math.min(minY, zeroLine);
      maxY = Math.max(maxY, zeroLine);
    }
    if (minY === maxY) { minY -= 1; maxY += 1; }

    const d = buildPath(view, chartW, chartH, minY, maxY);
    const zeroY = zeroLine !== undefined ? chartH - ((zeroLine - minY) / (maxY - minY || 1)) * chartH : null;
    return { d, zeroY, pad, chartW };
  }, [values, w, h, zeroLine]);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }} aria-label={label}>
      <g transform={`translate(${svg.pad || 6}, ${svg.pad || 6})`}>
        {svg.zeroY !== null && (
          <line x1="0" y1={svg.zeroY.toFixed(1)} x2={svg.chartW} y2={svg.zeroY.toFixed(1)} stroke="#2B3342" strokeWidth="1" strokeDasharray="2,2" />
        )}
        {svg.d && <path d={svg.d} fill="none" stroke={color} strokeWidth="1.6" />}
      </g>
    </svg>
  );
}