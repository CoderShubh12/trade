// lib/indicators.js
export function calculateEMA(data, period) {
  if (!Array.isArray(data) || data.length === 0 || !period || period < 1)
    return [];
  const k = 2 / (period + 1);
  const ema = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const cur = data[i] * k + ema[i - 1] * (1 - k);
    ema.push(cur);
  }
  return ema;
}

export function calculateRSI(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length === 0 || !period || period < 1)
    return [];
  if (closes.length <= period) return Array(closes.length).fill(50);

  const rsi = Array(period).fill(50);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }

  return rsi;
}

export function calculateMACD(closes) {
  if (!Array.isArray(closes) || closes.length === 0) {
    return { macdLine: [], signalLine: [], hist: [] };
  }
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - (ema26[i] ?? v));
  const signalLine = calculateEMA(macdLine, 9);
  const hist = macdLine.map((v, i) => v - (signalLine[i] ?? v));

  return { macdLine, signalLine, hist };
}

export function calculateVWAP(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  let cumVol = 0;
  let cumVolPrice = 0;
  let lastValidVwap = (data[0].high + data[0].low + data[0].close) / 3;

  return data.map((d) => {
    const typical = (d.high + d.low + d.close) / 3;
    const vol = Number(d.volume) || 0;
    if (vol > 0) {
      cumVolPrice += typical * vol;
      cumVol += vol;
      lastValidVwap = cumVolPrice / cumVol;
    }
    return lastValidVwap;
  });
}

export function calculateBollingerBands(
  closes,
  period = 20,
  stdDevMultiplier = 2,
) {
  const defaultVal =
    Array.isArray(closes) && closes.length > 0 ? closes[closes.length - 1] : 0;
  if (!Array.isArray(closes) || closes.length < period) {
    return {
      upper: defaultVal,
      middle: defaultVal,
      lower: defaultVal,
      bandwidth: 0,
      isSqueeze: false,
    };
  }

  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = Number((sma + stdDevMultiplier * stdDev).toFixed(2));
  const lower = Number((sma - stdDevMultiplier * stdDev).toFixed(2));
  const bandwidth = Number((((upper - lower) / (sma || 1)) * 100).toFixed(2));
  const isSqueeze = bandwidth < 1.35;

  return { upper, middle: Number(sma.toFixed(2)), lower, bandwidth, isSqueeze };
}

export function calculateCPR(data, baselineBars = 30) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const sample = data.slice(0, Math.min(baselineBars, data.length));
  const high = Math.max(...sample.map((d) => d.high));
  const low = Math.min(...sample.map((d) => d.low));
  const close = sample[sample.length - 1].close;

  const pivot = (high + low + close) / 3;
  const bc = (high + low) / 2;
  const tc = pivot * 2 - bc;

  const range = Math.abs(tc - bc);
  const cprWidthPct = (range / (pivot || 1)) * 100;
  let cprType = "Normal";
  if (cprWidthPct < 0.25) cprType = "Virgin / Narrow";
  else if (cprWidthPct > 0.6) cprType = "Wide CPR";

  return {
    pivot: Number(pivot.toFixed(2)),
    bc: Number(bc.toFixed(2)),
    tc: Number(tc.toFixed(2)),
    top: Number(Math.max(tc, bc).toFixed(2)),
    bottom: Number(Math.min(tc, bc).toFixed(2)),
    cprType,
  };
}

export function calculateATR(data, period = 14) {
  if (!Array.isArray(data) || data.length < 2) return 0;
  let trSum = 0;
  const count = Math.min(data.length - 1, period);
  const start = data.length - count;

  for (let i = start; i < data.length; i++) {
    const cur = data[i];
    const prev = data[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trSum += tr;
  }

  const rawAtr = trSum / (count || 1);
  const currentPrice = data[data.length - 1]?.close || 100;
  const maxAllowedAtr = currentPrice * 0.025;
  const minAllowedAtr = currentPrice * 0.004;
  return Math.max(minAllowedAtr, Math.min(rawAtr, maxAllowedAtr));
}

export function calculateTradeLevels(side, anchorPrice, rawAtr) {
  const price = Number(anchorPrice) || 100;
  const safeAtr = Math.max(
    price * 0.004,
    Math.min(rawAtr || price * 0.008, price * 0.025),
  );

  if (side === "BUY") {
    const sl = Number((price - safeAtr * 1.2).toFixed(2));
    const t1 = Number((price + safeAtr * 2.0).toFixed(2));
    const t2 = Number((price + safeAtr * 3.5).toFixed(2));
    const risk = Number((price - sl).toFixed(2));
    const reward1 = Number((t1 - price).toFixed(2));
    const reward2 = Number((t2 - price).toFixed(2));
    const actualRr = risk > 0 ? (reward1 / risk).toFixed(1) : "0.0";

    return {
      sl: Math.max(0.05, sl),
      t1,
      t2,
      risk,
      reward1,
      reward2,
      rrRatio: `1:${actualRr}`,
    };
  } else {
    const sl = Number((price + safeAtr * 1.2).toFixed(2));
    const t1 = Number((price - safeAtr * 2.0).toFixed(2));
    const t2 = Number((price - safeAtr * 3.5).toFixed(2));
    const risk = Number((sl - price).toFixed(2));
    const reward1 = Number((price - Math.max(0.05, t1)).toFixed(2));
    const reward2 = Number((price - Math.max(0.05, t2)).toFixed(2));
    const actualRr = risk > 0 ? (reward1 / risk).toFixed(1) : "0.0";

    return {
      sl,
      t1: Math.max(0.05, t1),
      t2: Math.max(0.05, t2),
      risk,
      reward1,
      reward2,
      rrRatio: `1:${actualRr}`,
    };
  }
}

export function computeAll(data, tf = 5) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const closes = data.map((d) => d.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const vwap = calculateVWAP(data);
  const rsi14 = calculateRSI(closes, 14);
  const { hist } = calculateMACD(closes);
  const cpr = calculateCPR(data, 30);
  const bb = calculateBollingerBands(closes, 20, 2);

  const lastIdx = data.length - 1;
  const latestPrice = closes[lastIdx];
  const latestVwap = vwap[lastIdx];
  const latestE9 = ema9[lastIdx];
  const latestE21 = ema21[lastIdx];
  const latestRsi = rsi14[lastIdx] ?? 50;
  const latestHist = hist[lastIdx] ?? 0;

  const orBarsCount = Math.max(1, Math.round(30 / (tf || 5)));
  const orSlice = data.slice(0, Math.min(orBarsCount, data.length));
  const orHigh = Math.max(...orSlice.map((d) => d.high));
  const orLow = Math.min(...orSlice.map((d) => d.low));

  let orbState = "Inside Range";
  if (latestPrice > orHigh) orbState = "Breakout High";
  else if (latestPrice < orLow) orbState = "Breakdown Low";

  const vwapDiffPct = ((latestPrice - latestVwap) / (latestVwap || 1)) * 100;
  let vwapScore = 0;
  if (vwapDiffPct > 0.1) vwapScore = 22;
  else if (vwapDiffPct < -0.1) vwapScore = -22;

  let trendScore = latestE9 > latestE21 ? 18 : latestE9 < latestE21 ? -18 : 0;
  let macdScore = latestHist > 0.02 ? 18 : latestHist < -0.02 ? -18 : 0;

  let rsiScore = 0;
  if (latestRsi >= 56 && latestRsi <= 68) rsiScore = 14;
  else if (latestRsi <= 44 && latestRsi >= 32) rsiScore = -14;
  else if (latestRsi > 70) rsiScore = 4;
  else if (latestRsi < 30) rsiScore = -4;

  let cprScore = 0;
  let cprState = "Inside CPR";
  if (cpr) {
    if (latestPrice > cpr.top) {
      cprScore = 12;
      cprState = "Above CPR (Bullish)";
    } else if (latestPrice < cpr.bottom) {
      cprScore = -12;
      cprState = "Below CPR (Bearish)";
    }
  }

  let orbScore =
    orbState === "Breakout High" ? 8 : orbState === "Breakdown Low" ? -8 : 0;

  const currentVol = data[lastIdx]?.volume || 1;
  const avgVol =
    data.slice(-10).reduce((acc, c) => acc + (c.volume || 1), 0) /
    Math.min(data.length, 10);

  let volScore = currentVol >= avgVol * 1.4 ? 8 : 2;
  if (trendScore < 0) volScore = -volScore;

  const technicalScore = Math.max(
    -100,
    Math.min(
      100,
      vwapScore +
        trendScore +
        macdScore +
        rsiScore +
        cprScore +
        orbScore +
        volScore,
    ),
  );

  return {
    ema9,
    ema21,
    vwap,
    rsi14,
    hist,
    cpr,
    cprState,
    bb,
    orb: { high: orHigh, low: orLow },
    orHigh,
    orLow,
    orbState,
    latest: {
      price: latestPrice,
      vwap: latestVwap,
      ema9: latestE9,
      ema21: latestE21,
      rsi: latestRsi,
      hist: latestHist,
    },
    scores: {
      vwapScore,
      trendScore,
      macdScore,
      rsiScore,
      cprScore,
      orbScore,
      volScore,
      technicalScore,
    },
  };
}
