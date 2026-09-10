// Technical Indicator Engine for Intraday Setup

export function calculateEMA(data, period) {
  if (!data || data.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [];
  let prev = data[0];
  ema.push(prev);

  for (let i = 1; i < data.length; i++) {
    const cur = data[i] * k + prev * (1 - k);
    ema.push(cur);
    prev = cur;
  }
  return ema;
}

export function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period)
    return Array(closes?.length || 0).fill(50);
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
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss =
      (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

export function calculateMACD(closes) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - (ema26[i] || v));
  const signalLine = calculateEMA(macdLine, 9);
  const hist = macdLine.map((v, i) => v - (signalLine[i] || v));

  return { macdLine, signalLine, hist };
}

export function calculateVWAP(data) {
  let cumVol = 0;
  let cumVolPrice = 0;
  return data.map((d) => {
    const typical = (d.high + d.low + d.close) / 3;
    const vol = Math.max(1, d.volume || 1);
    cumVolPrice += typical * vol;
    cumVol += vol;
    return cumVolPrice / cumVol;
  });
}

export function calculateCPR(data) {
  if (!data || data.length === 0) return null;
  // Use previous session/first chunk high, low, close
  const high = Math.max(
    ...data.slice(0, Math.min(30, data.length)).map((d) => d.high),
  );
  const low = Math.min(
    ...data.slice(0, Math.min(30, data.length)).map((d) => d.low),
  );
  const close = data[Math.min(30, data.length) - 1].close;

  const pivot = (high + low + close) / 3;
  const bc = (high + low) / 2;
  const tc = pivot * 2 - bc;

  const range = Math.abs(tc - bc);
  const cprWidthPct = (range / pivot) * 100;
  let cprType = "Normal";
  if (cprWidthPct < 0.25) cprType = "Virgin / Narrow";
  else if (cprWidthPct > 0.6) cprType = "Wide CPR";

  return {
    pivot: Number(pivot.toFixed(2)),
    bc: Number(bc.toFixed(2)),
    tc: Number(tc.toFixed(2)),
    cprType,
  };
}

export function calculateATR(data, period = 14) {
  if (!data || data.length < 2) return 1;
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

  const rawAtr = trSum / count;
  const currentPrice = data[data.length - 1]?.close || 100;

  // Relative Cap: prevents insane ATR on stock change
  const maxAllowedAtr = currentPrice * 0.035;
  return Math.max(0.05, Math.min(rawAtr, maxAllowedAtr));
}

export function calculateTradeLevels(side, ltp, rawAtr) {
  const safeAtr = Math.max(ltp * 0.005, Math.min(rawAtr, ltp * 0.03));

  if (side === "BUY") {
    const sl = Number((ltp - safeAtr * 1.2).toFixed(2));
    const t1 = Number((ltp + safeAtr * 1.5).toFixed(2));
    const t2 = Number((ltp + safeAtr * 2.5).toFixed(2));
    return {
      sl: Math.max(0.05, sl),
      t1,
      t2,
      risk: Number((ltp - sl).toFixed(2)),
      reward1: Number((t1 - ltp).toFixed(2)),
      reward2: Number((t2 - ltp).toFixed(2)),
    };
  } else {
    const sl = Number((ltp + safeAtr * 1.2).toFixed(2));
    const t1 = Number((ltp - safeAtr * 1.5).toFixed(2));
    const t2 = Number((ltp - safeAtr * 2.5).toFixed(2));
    return {
      sl,
      t1: Math.max(0.05, t1),
      t2: Math.max(0.05, t2),
      risk: Number((sl - ltp).toFixed(2)),
      reward1: Number((ltp - Math.max(0.05, t1)).toFixed(2)),
      reward2: Number((ltp - Math.max(0.05, t2)).toFixed(2)),
    };
  }
}

// Master Computation Hook
export function computeAll(data, tf = 5) {
  if (!data || data.length === 0) return null;

  const closes = data.map((d) => d.close);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const vwap = calculateVWAP(data);
  const rsi14 = calculateRSI(closes, 14);
  const { hist } = calculateMACD(closes);
  const cpr = calculateCPR(data);

  const lastIdx = data.length - 1;
  const latestPrice = closes[lastIdx];
  const latestVwap = vwap[lastIdx];
  const latestE9 = ema9[lastIdx];
  const latestE21 = ema21[lastIdx];
  const latestRsi = rsi14[lastIdx] || 50;
  const latestHist = hist[lastIdx] || 0;

  // Opening Range (30 mins = 6 bars of 5m)
  const orBarsCount = Math.max(1, Math.round(30 / (tf || 5)));
  const orHigh = Math.max(
    ...data.slice(0, Math.min(orBarsCount, data.length)).map((d) => d.high),
  );
  const orLow = Math.min(
    ...data.slice(0, Math.min(orBarsCount, data.length)).map((d) => d.low),
  );

  let orbState = "Inside Range";
  if (latestPrice > orHigh) orbState = "Breakout High";
  else if (latestPrice < orLow) orbState = "Breakdown Low";

  // Institutional Weighted Matrix
  let vwapScore = latestPrice >= latestVwap ? 22 : -22;
  let trendScore = latestE9 >= latestE21 ? 18 : -18;
  let macdScore = latestHist >= 0 ? 18 : -18;

  let rsiScore = 0;
  if (latestRsi >= 55 && latestRsi <= 70) rsiScore = 14;
  else if (latestRsi < 45 && latestRsi >= 30) rsiScore = -14;
  else if (latestRsi > 70) rsiScore = 6;
  else rsiScore = -6;

  let cprScore = 0;
  let cprState = "Inside CPR";
  if (cpr) {
    const topCpr = Math.max(cpr.tc, cpr.bc);
    const btmCpr = Math.min(cpr.tc, cpr.bc);
    if (latestPrice > topCpr) {
      cprScore = 12;
      cprState = "Above CPR (Bullish)";
    } else if (latestPrice < btmCpr) {
      cprScore = -12;
      cprState = "Below CPR (Bearish)";
    }
  }

  let orbScore =
    orbState === "Breakout High" ? 8 : orbState === "Breakdown Low" ? -8 : 0;
  let volScore =
    (data[lastIdx].volume || 1) > (data[lastIdx - 1]?.volume || 1) * 1.5
      ? 8
      : 2;
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
    orHigh,
    orLow,
    orbState,
    latest: {
      price: latestPrice,
      vwap: latestVwap,
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
