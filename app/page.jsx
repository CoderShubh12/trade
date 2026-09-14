// app/page.jsx
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Gauge from "@/components/Gauge";
import MiniChart from "@/components/MiniChart";
import PriceChart from "@/components/PriceChart";
import SessionStatus from "@/components/SessionStatus";
import AiRecommendation from "@/components/AiRecommendation";
import SignalAlertModal from "@/components/SignalAlertModal";
import StockSearch from "@/components/StockSearch";
import ExecutionDeckComponent from "@/components/ExecutionDeck";
import PriceBandScanner from "@/components/PriceBandScanner";
import AccuracyTracker from "@/components/AccuracyTracker";
import { STOCK_POOL } from "@/lib/stockPool";
import AiAnalystPanel from "@/components/AiAnalystPanel";
import {
  computeAll,
  calculateATR,
  calculateTradeLevels,
} from "@/lib/indicators";
import { detectCandlePattern } from "@/lib/candlestickEngine";
import { parseBinaryPacket } from "@/lib/angelStream";
import { fmt, isMarketOpen, playAlertTone } from "@/lib/utils";
import {
  detectMarketRegime,
  checkIndicatorConflicts,
} from "@/lib/marketRegime";
import { calculatePositionSize, checkDailyRiskLimits } from "@/lib/riskEngine";
import {
  checkMarketLiquidityAndGaps,
  checkSignalCooldown,
  checkKillSwitch,
  toggleKillSwitch,
} from "@/lib/advancedGuards";

// Chartink-Style Screener Preset Definitions
const CHARTINK_STRATEGIES = [
  {
    id: "BULLISH_VWAP_CROSS",
    name: "⚡ 5M VWAP + EMA 9/21 Cross",
    description: "Close crosses above VWAP with Bullish EMA Stack & RSI > 55",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest) return false;
      const { price, vwap, ema9, ema21, rsi } = ind.latest;
      const prev = candles[candles.length - 2];
      return price > vwap && prev.close <= vwap && ema9 > ema21 && rsi >= 55;
    },
  },
  {
    id: "ORB_BREAKOUT_VOL",
    name: "🚀 15M ORB High Breakout + 2x Vol",
    description: "Opening range breakout with volume > 2x of 20-period average",
    evaluate: (candles) => {
      if (!candles || candles.length < 15) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.orb || !ind?.latest) return false;
      const { price } = ind.latest;
      const currentVol = candles[candles.length - 1]?.volume || 0;
      const avgVol =
        candles.slice(-20).reduce((acc, c) => acc + (c.volume || 1), 0) / 20;
      return price > ind.orb.high && currentVol >= avgVol * 2.0;
    },
  },
  {
    id: "BEARISH_BREAKDOWN",
    name: "🔻 Institutional Short (VWAP Breakdown)",
    description: "Close breaks below Session VWAP & CPR with Bearish MACD",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest || !ind?.cpr) return false;
      const { price, vwap, hist } = ind.latest;
      return price < vwap && price < ind.cpr.bc && hist < 0;
    },
  },
  {
    id: "BB_SQUEEZE_BLAST",
    name: "💥 Bollinger Band Squeeze Blast",
    description: "Volatility breakout after severe band contraction",
    evaluate: (candles) => {
      if (!candles || candles.length < 25) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.bb || !ind?.latest) return false;
      return ind.bb.isSqueeze && ind.latest.price > ind.bb.upper;
    },
  },
];

// Custom Indicator Bar with Simple English Tooltips
function TooltipIndicatorBar({ name, score = 0, detail = "—", tooltip = "" }) {
  const safeScore = typeof score === "number" && !isNaN(score) ? score : 0;
  const isPositive = safeScore >= 0;
  const barWidth = Math.min(100, (Math.abs(safeScore) / 25) * 100);
  const color = isPositive ? "#2FD98A" : "#FF5D5D";

  return (
    <div
      className="has-tooltip"
      data-tip={tooltip}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "10px 12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "6px",
        marginBottom: "8px",
        transition: "border-color 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.78rem",
        }}
      >
        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
          {name} <span style={{ color: "#64748b", fontSize: "0.7rem" }}>ⓘ</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>
            {detail}
          </span>
          <span
            style={{
              color,
              fontWeight: 700,
              minWidth: "45px",
              textAlign: "right",
            }}
          >
            {isPositive ? `+${safeScore}` : safeScore} pts
          </span>
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: "5px",
          background: "#1e293b",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${barWidth}%`,
            height: "100%",
            backgroundColor: color,
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

const SafeExecutionDeck = ExecutionDeckComponent || (() => null);

const TIMEFRAMES = [
  { label: "1m", value: "1" },
  { label: "3m", value: "3" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
];

export default function DashboardPage() {
  const [currentStock, setCurrentStock] = useState({
    symbol: "SBIN",
    token: "3045",
    exchangeSegment: 1,
  });
  const [selectedTF, setSelectedTF] = useState("5");
  const [data, setData] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const [niftyData, setNiftyData] = useState({
    ltp: 0,
    open: 0,
    change: 0,
    changePercent: 0,
  });

  const [scannerTicks, setScannerTicks] = useState({});
  const [activeAlert, setActiveAlert] = useState(null);
  const wsRef = useRef(null);

  const [selectedStrategy, setSelectedStrategy] =
    useState("BULLISH_VWAP_CROSS");
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerMatches, setScreenerMatches] = useState([]);
  const [lastScanTimestamp, setLastScanTimestamp] = useState(null);

  const activeTradesRef = useRef({});
  const lastProcessedCandleTime = useRef(null);
  const lastTickTimeRef = useRef(Date.now());
  const dailyRiskStateRef = useRef({
    tradesCount: 0,
    consecutiveLosses: 0,
    totalPnL: 0,
  });

  // 💾 1. Load Stored Sessions & Active Trades on Mount
  useEffect(() => {
    try {
      const savedStock = localStorage.getItem("last_active_stock");
      if (savedStock) {
        const parsed = JSON.parse(savedStock);
        if (parsed?.symbol && parsed?.token) {
          setCurrentStock(parsed);
        }
      }

      const savedTrades = localStorage.getItem("terminal_active_trades");
      if (savedTrades) {
        activeTradesRef.current = JSON.parse(savedTrades);
      }
    } catch (e) {
      console.warn("Could not restore session state:", e);
    }
  }, []);

  const persistTrades = () => {
    try {
      localStorage.setItem(
        "terminal_active_trades",
        JSON.stringify(activeTradesRef.current),
      );
    } catch (e) {
      console.warn("Could not save trades to storage:", e);
    }
  };

  // Stale Data & WebSocket Health Monitor
  useEffect(() => {
    const interval = setInterval(() => {
      const timeSinceLastTick = Date.now() - lastTickTimeRef.current;
      if (timeSinceLastTick > 12000 && wsConnected) {
        console.warn("Stale data detected! Reconnecting WebSocket feed...");
        setWsConnected(false);
        if (wsRef.current) wsRef.current.close();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  const handleStockChange = (stock) => {
    setData([]);
    setActiveAlert(null);
    setCurrentStock(stock);
    try {
      localStorage.setItem("last_active_stock", JSON.stringify(stock));
    } catch (e) {
      console.warn("Could not persist session stock:", e);
    }
  };

  // 2. Fetch Historical Candles
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadHistory() {
      try {
        const res = await fetch(
          `/api/market-data?token=${currentStock.token}&tf=${selectedTF}`,
          { signal: controller.signal },
        );
        const json = await res.json();

        if (isMounted) {
          if (json.success && json.data?.length > 0) {
            setData(json.data);
            setErrorMsg(null);
          } else if (!json.fallback) {
            setErrorMsg(json.error || "Failed to load market candles");
          }
        }
      } catch (e) {
        if (isMounted && e.name !== "AbortError") {
          setErrorMsg("Could not fetch market data from local bridge");
        }
      }
    }

    if (currentStock?.token) {
      loadHistory();
    }

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [currentStock.token, selectedTF]);

  // 3. Real-Time SmartStream Multi-Token Subscription & Auto-Reconnection
  useEffect(() => {
    let isMounted = true;

    async function connectWebSocket() {
      try {
        const res = await fetch("/api/ws-token");
        const json = await res.json();
        if (!json.success || !json.data) {
          if (isMounted) setWsConnected(false);
          return;
        }

        const { clientCode, feedToken } = json.data;
        const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${encodeURIComponent(
          clientCode,
        )}&feedToken=${encodeURIComponent(feedToken)}`;

        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setWsConnected(true);
          lastTickTimeRef.current = Date.now();

          const poolTokens = STOCK_POOL.map((s) => String(s.token));

          ws.send(
            JSON.stringify({
              correlationID: "terminal_stream_v2",
              action: 1,
              params: {
                mode: 2,
                tokenList: [
                  {
                    exchangeType: currentStock.exchangeSegment || 1,
                    tokens: [String(currentStock.token)],
                  },
                  {
                    exchangeType: 13,
                    tokens: ["99926000"], // NIFTY 50 Index Spot
                  },
                  {
                    exchangeType: 1,
                    tokens: poolTokens,
                  },
                ],
              },
            }),
          );
        };

        ws.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          lastTickTimeRef.current = Date.now();
          const tick = parseBinaryPacket(event.data);
          if (!tick || !tick.ltp || tick.ltp <= 0) return;

          // A. NIFTY 50 Tick
          if (tick.token === "99926000") {
            setNiftyData((prev) => {
              const basePrice = prev.open > 0 ? prev.open : tick.ltp;
              const chg = tick.ltp - basePrice;
              const chgPct = basePrice > 0 ? (chg / basePrice) * 100 : 0;
              return {
                ltp: tick.ltp,
                open: basePrice,
                change: chg,
                changePercent: chgPct,
              };
            });
            return;
          }

          // B. Active Stock Candlestick Live Update
          if (tick.token === String(currentStock.token)) {
            setData((prev) => {
              if (!prev || prev.length === 0) return prev;
              const lastIdx = prev.length - 1;
              const last = prev[lastIdx];
              const updatedLast = {
                ...last,
                high: Math.max(last.high, tick.ltp),
                low: Math.min(last.low, tick.ltp),
                close: tick.ltp,
                volume: tick.volume ? tick.volume : (last.volume || 0) + 1,
              };
              return [...prev.slice(0, -1), updatedLast];
            });
          }

          // C. Scanner Pool Tick Update
          setScannerTicks((prev) => {
            const prevTick = prev[tick.token] || {};
            const isVolSpike = tick.lastTradedQty && tick.lastTradedQty > 2000;

            return {
              ...prev,
              [tick.token]: {
                ltp: tick.ltp,
                volume: tick.volume || prevTick.volume || 0,
                score: prevTick.score || 0,
                isScalperSpike: isVolSpike,
                isTrap: isVolSpike && tick.ltp < (prevTick.ltp || tick.ltp),
              },
            };
          });
        };

        ws.onerror = () => isMounted && setWsConnected(false);
        ws.onclose = () => {
          if (isMounted) {
            setWsConnected(false);
            setTimeout(connectWebSocket, 3000);
          }
        };
      } catch (err) {
        if (isMounted) setWsConnected(false);
      }
    }

    connectWebSocket();
    return () => {
      isMounted = false;
      if (wsRef.current) wsRef.current.close();
    };
  }, [currentStock.token, currentStock.exchangeSegment]);

  // Calculations
  const ind = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeAll(data, Number(selectedTF));
  }, [data, selectedTF]);

  const marketRegime = useMemo(() => detectMarketRegime(data), [data]);
  const indicatorConflict = useMemo(
    () => checkIndicatorConflicts(ind?.scores),
    [ind?.scores],
  );

  // 🕯️ 1. Detect Candlestick Pattern on Active Stock Candles
  const candlePattern = useMemo(() => {
    return detectCandlePattern(data);
  }, [data]);

  const scores = ind?.scores || {
    trendScore: 0,
    rsiScore: 0,
    macdScore: 0,
    vwapScore: 0,
    cprScore: 0,
    orbScore: 0,
    volScore: 0,
    technicalScore: 0,
  };

  // 🎯 2. Combined Composite Score
  const finalCompositeScore = useMemo(() => {
    const baseScore = scores.technicalScore || 0;
    const candleBoost = candlePattern.score || 0;
    return Math.max(
      -100,
      Math.min(100, Math.round(baseScore * 0.8 + candleBoost)),
    );
  }, [scores.technicalScore, candlePattern.score]);

  useEffect(() => {
    if (currentStock?.token && finalCompositeScore !== undefined) {
      setScannerTicks((prev) => ({
        ...prev,
        [String(currentStock.token)]: {
          ...(prev[String(currentStock.token)] || {}),
          score: finalCompositeScore,
        },
      }));
    }
  }, [currentStock.token, finalCompositeScore]);

  const currentAtr = useMemo(() => calculateATR(data, 14), [data]);
  const isExecutionTimeframe = selectedTF === "5";
  const marketLive = isMarketOpen();

  const isHighMomentumTimeWindow = useMemo(() => {
    const now = new Date();
    const timeNum = now.getHours() * 100 + now.getMinutes();
    return (
      (timeNum >= 930 && timeNum <= 1130) ||
      (timeNum >= 1330 && timeNum <= 1445)
    );
  }, [data]);

  const niftyBias = useMemo(() => {
    if (niftyData.changePercent <= -0.2) return "BEARISH";
    if (niftyData.changePercent >= 0.2) return "BULLISH";
    return "NEUTRAL";
  }, [niftyData.changePercent]);

  // ⚡ Chartink-Style Screener Runner
  const handleRunChartinkScan = async () => {
    const strat = CHARTINK_STRATEGIES.find((s) => s.id === selectedStrategy);
    if (!strat) return;

    setScreenerLoading(true);
    const matches = [];
    const scanPool = STOCK_POOL.slice(0, 35);

    for (const st of scanPool) {
      try {
        const res = await fetch(`/api/market-data?token=${st.token}&tf=5`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (json.success && json.data?.length >= 25) {
          if (strat.evaluate(json.data)) {
            const lastCandle = json.data[json.data.length - 1];
            matches.push({
              symbol: st.symbol,
              token: st.token,
              exchangeSegment: st.segment || 1,
              price: lastCandle.close,
            });
          }
        }
      } catch (err) {
        // Skip individual error
      }
    }

    setScreenerMatches(matches);
    setLastScanTimestamp(new Date().toLocaleTimeString("en-IN"));
    setScreenerLoading(false);
  };

  // 🚨 Synchronized Execution Engine with Advanced Guards & Daily Risk Shields
  useEffect(() => {
    if (!ind?.latest?.price || !data || data.length < 2) return;
    if (!marketLive) return;
    if (!isExecutionTimeframe) return;

    // Emergency Kill Switch Guard
    if (checkKillSwitch()) return;

    const stockToken = String(currentStock.token);
    const activeTrade = activeTradesRef.current[stockToken];
    const currentPrice = ind.latest.price;
    const vwap = ind.latest.vwap;

    // --- A. RUNNING TRADE PROTECTION ENGINE ---
    if (activeTrade) {
      const vwapBuffer = vwap * 0.0005;
      const isBuyVwapBreach =
        activeTrade.side === "BUY" && currentPrice < vwap - vwapBuffer;
      const isSellVwapBreach =
        activeTrade.side === "SELL" && currentPrice > vwap + vwapBuffer;

      const isTargetHit =
        (activeTrade.side === "BUY" && currentPrice >= activeTrade.target1) ||
        (activeTrade.side === "SELL" && currentPrice <= activeTrade.target1);

      const isSlHit =
        (activeTrade.side === "BUY" && currentPrice <= activeTrade.sl) ||
        (activeTrade.side === "SELL" && currentPrice >= activeTrade.sl);

      const isStagnant = Date.now() > activeTrade.maxTime;

      if (isBuyVwapBreach || isSellVwapBreach) {
        playAlertTone("EXIT_NOW");
        setActiveAlert({
          type: "EXIT_NOW",
          symbol: currentStock.symbol,
          reason: "Price breached Session VWAP buffer",
          exitPrice: currentPrice,
          vwapPrice: vwap,
        });
        delete activeTradesRef.current[stockToken];
        persistTrades();
        return;
      }

      if (isTargetHit) {
        playAlertTone("BUY");
        setActiveAlert({
          type: "TARGET_HIT",
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          message: "🎯 Target 1 reached! Secure partial profits.",
        });
        dailyRiskStateRef.current.tradesCount += 1;
        delete activeTradesRef.current[stockToken];
        persistTrades();
        return;
      }

      if (isSlHit) {
        playAlertTone("SL_HIT");
        setActiveAlert({
          type: "SL_HIT",
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          message: "🛑 Stop Loss hit. Capital protected.",
        });
        dailyRiskStateRef.current.tradesCount += 1;
        dailyRiskStateRef.current.consecutiveLosses += 1;
        delete activeTradesRef.current[stockToken];
        persistTrades();
        return;
      }

      if (isStagnant) {
        playAlertTone("EXIT_NOW");
        setActiveAlert({
          type: "EXIT_NOW",
          symbol: currentStock.symbol,
          reason: "25-Minute Timeout Decay reached.",
          exitPrice: currentPrice,
          vwapPrice: vwap,
        });
        delete activeTradesRef.current[stockToken];
        persistTrades();
        return;
      }

      return;
    }

    // --- B. ADVANCED GUARDS & RISK SHIELDS ---
    const dailyRiskCheck = checkDailyRiskLimits(
      dailyRiskStateRef.current.tradesCount,
      dailyRiskStateRef.current.consecutiveLosses,
      dailyRiskStateRef.current.totalPnL,
    );
    if (!dailyRiskCheck.allowed) return;

    const cooldownCheck = checkSignalCooldown(10);
    if (!cooldownCheck.allowed) return;

    const prevClose = data[data.length - 2]?.close || currentPrice;
    const liquidityCheck = checkMarketLiquidityAndGaps(
      data,
      currentPrice,
      prevClose,
    );
    if (!liquidityCheck.passed) return;

    const completedCandle = data[data.length - 2];
    if (
      !completedCandle ||
      completedCandle.time === lastProcessedCandleTime.current
    ) {
      return;
    }

    if (!isHighMomentumTimeWindow) return;
    if (marketRegime === "CHOPPY_SIDEWAYS") return;
    if (indicatorConflict.hasConflict) return;

    const isBearishRejectionCandle =
      candlePattern.bias.includes("BEARISH") &&
      candlePattern.type === "REVERSAL";
    const isBullishRejectionCandle =
      candlePattern.bias.includes("BULLISH") &&
      candlePattern.type === "REVERSAL";

    // 🚀 BUY Trigger
    if (
      finalCompositeScore >= 65 &&
      niftyBias !== "BEARISH" &&
      !isBearishRejectionCandle
    ) {
      lastProcessedCandleTime.current = completedCandle.time;
      const levels = calculateTradeLevels("BUY", currentPrice, currentAtr);

      activeTradesRef.current[stockToken] = {
        side: "BUY",
        entry: currentPrice,
        target1: levels.target1,
        target2: levels.target2,
        sl: levels.stopLoss,
        startTime: Date.now(),
        maxTime: Date.now() + 25 * 60 * 1000,
      };
      persistTrades();

      setActiveAlert({
        type: "BUY",
        symbol: currentStock.symbol,
        price: currentPrice,
        score: finalCompositeScore,
        pattern: candlePattern.name,
        vwap,
        rsi: ind.latest.rsi,
        orbState: ind.orbState,
        atr: currentAtr,
        levels,
      });
      playAlertTone("BUY");
    }

    // 🔻 SELL Trigger
    else if (
      finalCompositeScore <= -65 &&
      niftyBias !== "BULLISH" &&
      !isBullishRejectionCandle
    ) {
      lastProcessedCandleTime.current = completedCandle.time;
      const levels = calculateTradeLevels("SELL", currentPrice, currentAtr);

      activeTradesRef.current[stockToken] = {
        side: "SELL",
        entry: currentPrice,
        target1: levels.target1,
        target2: levels.target2,
        sl: levels.stopLoss,
        startTime: Date.now(),
        maxTime: Date.now() + 25 * 60 * 1000,
      };
      persistTrades();

      setActiveAlert({
        type: "SELL",
        symbol: currentStock.symbol,
        price: currentPrice,
        score: finalCompositeScore,
        pattern: candlePattern.name,
        vwap,
        rsi: ind.latest.rsi,
        orbState: ind.orbState,
        atr: currentAtr,
        levels,
      });
      playAlertTone("SELL");
    }
  }, [
    finalCompositeScore,
    candlePattern,
    ind,
    data,
    currentStock,
    currentAtr,
    isExecutionTimeframe,
    marketLive,
    isHighMomentumTimeWindow,
    niftyBias,
    marketRegime,
    indicatorConflict,
  ]);

  const stockTokenStr = String(currentStock.token);
  const isSetupActive =
    marketLive &&
    !killSwitchActive &&
    (Math.abs(finalCompositeScore) >= 65 ||
      !!activeTradesRef.current[stockTokenStr]);

  const patternBadgeColor = candlePattern.bias.includes("BULLISH")
    ? "#2FD98A"
    : candlePattern.bias.includes("BEARISH")
      ? "#FF5D5D"
      : "#94a3b8";

  return (
    <main className="dashboard-container">
      {/* Header Bar */}
      <header className="dash-header">
        <div
          className="brand-group"
          style={{ display: "flex", alignItems: "center", gap: "10px" }}
        >
          <h1 className="title">NSE INTRADAY BIAS // TERMINAL V2</h1>
          {SessionStatus ? <SessionStatus /> : null}

          {/* NIFTY 50 Live Indicator */}
          <div
            className="has-tooltip"
            data-tip="NIFTY 50 Market Direction. Filters counter-trend momentum traps."
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "3px 9px",
              borderRadius: 4,
              background: "#0f172a",
              border: `1px solid ${
                niftyBias === "BULLISH"
                  ? "#2FD98A40"
                  : niftyBias === "BEARISH"
                    ? "#FF5D5D40"
                    : "#1e293b"
              }`,
              fontSize: "0.74rem",
              fontWeight: 600,
            }}
          >
            <span style={{ color: "#94a3b8" }}>NIFTY 50</span>
            <span
              style={{
                color: niftyData.change >= 0 ? "#2FD98A" : "#FF5D5D",
                fontFamily: "monospace",
              }}
            >
              {niftyData.ltp > 0 ? fmt(niftyData.ltp) : "Syncing..."}
            </span>
            {niftyData.ltp > 0 && (
              <span
                style={{
                  fontSize: "0.68rem",
                  color: niftyData.change >= 0 ? "#2FD98A" : "#FF5D5D",
                }}
              >
                ({niftyData.change >= 0 ? "+" : ""}
                {fmt(niftyData.changePercent, 2)}%)
              </span>
            )}
          </div>

          <span
            className="has-tooltip"
            data-tip="Angel One SmartStream V2 WebSocket feed with Auto-Reconnection & Stale Data protection."
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background: wsConnected
                ? "rgba(47, 217, 138, 0.15)"
                : "rgba(255, 93, 93, 0.15)",
              color: wsConnected ? "#2FD98A" : "#FF5D5D",
              border: `1px solid ${wsConnected ? "#2FD98A" : "#FF5D5D"}`,
            }}
          >
            {wsConnected ? "● LIVE" : "○ RECONNECTING..."}
          </span>

          <span
            className="has-tooltip"
            data-tip={`Market Regime: ${marketRegime}. Chop zones automatically suppress false breakouts.`}
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background:
                marketRegime === "TRENDY_MOMENTUM"
                  ? "rgba(47, 217, 138, 0.1)"
                  : "rgba(245, 184, 65, 0.1)",
              color: marketRegime === "TRENDY_MOMENTUM" ? "#2FD98A" : "#F5B841",
              border: `1px solid ${marketRegime === "TRENDY_MOMENTUM" ? "#2FD98A40" : "#F5B84140"}`,
              fontWeight: 600,
            }}
          >
            {marketRegime === "TRENDY_MOMENTUM" ? "📈 TRENDY" : "📉 CHOPPY"}
          </span>

          {/* Emergency Kill Switch Toggle */}
          <button
            onClick={() => {
              const newState = !killSwitchActive;
              setKillSwitchActive(newState);
              toggleKillSwitch(newState);
            }}
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background: killSwitchActive
                ? "#FF5D5D"
                : "rgba(255, 93, 93, 0.15)",
              color: killSwitchActive ? "#fff" : "#FF5D5D",
              border: "1px solid #FF5D5D",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {killSwitchActive ? "🚨 KILL SWITCH ACTIVE" : "⚡ KILL SWITCH"}
          </button>

          <Link
            href="/tips"
            className="has-tooltip"
            data-tip="View risk playbook and institutional sizing guidelines."
            style={{
              fontSize: "0.72rem",
              padding: "4px 10px",
              borderRadius: 4,
              background: "rgba(91, 140, 255, 0.12)",
              color: "#5B8CFF",
              border: "1px solid rgba(91, 140, 255, 0.3)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            📖 PLAYBOOK
          </Link>
        </div>

        <div
          className="actions-group"
          style={{ display: "flex", alignItems: "center", gap: "12px" }}
        >
          <div
            className="tf-group has-tooltip"
            data-tip="Trade signals are strictly locked to the 5M timeframe."
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                className={`tf-btn ${selectedTF === tf.value ? "active" : ""}`}
                onClick={() => setSelectedTF(tf.value)}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <StockSearch
            selectedSymbol={currentStock.symbol}
            onSelectStock={handleStockChange}
          />

          <span
            className="active-ticker has-tooltip"
            data-tip="Active stock symbol."
            style={{ minWidth: "95px", textAlign: "center" }}
          >
            {currentStock.symbol}
          </span>
        </div>
      </header>

      {/* Top 5 Price Band Scanner */}
      <PriceBandScanner
        stocks={STOCK_POOL}
        marketTicks={scannerTicks}
        activeSymbol={currentStock.symbol}
        onSelectStock={handleStockChange}
      />

      {/* 📊 Chartink-Style Screener Widget */}
      <section
        style={{
          margin: "12px 0",
          padding: "12px 16px",
          background: "#080d1a",
          border: "1px solid #1e293b",
          borderRadius: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontSize: "0.82rem",
                fontWeight: 800,
                color: "#38bdf8",
                letterSpacing: "0.04em",
              }}
            >
              📊 INTRADAY SCANNER (CHARTINK ENGINE) ⓘ
            </span>
            {lastScanTimestamp && (
              <span style={{ fontSize: "0.68rem", color: "#64748b" }}>
                Scanned at: {lastScanTimestamp}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <select
              value={selectedStrategy}
              onChange={(e) => setSelectedStrategy(e.target.value)}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#f8fafc",
                padding: "5px 10px",
                borderRadius: "4px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              {CHARTINK_STRATEGIES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleRunChartinkScan}
              disabled={screenerLoading}
              style={{
                background: screenerLoading ? "#334155" : "#0284c7",
                color: "#fff",
                border: "none",
                padding: "5px 14px",
                borderRadius: "4px",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: screenerLoading ? "not-allowed" : "pointer",
              }}
            >
              {screenerLoading ? "SCANNING POOL..." : "⚡ RUN SCAN"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            minHeight: "32px",
            alignItems: "center",
          }}
        >
          {screenerMatches.length === 0 && !screenerLoading && (
            <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
              Click 'RUN SCAN' to search pool matching strategies.
            </span>
          )}

          {screenerMatches.map((st) => (
            <button
              key={st.token}
              onClick={() => handleStockChange(st)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: "4px",
                color: "#38bdf8",
                cursor: "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              <span>{st.symbol}</span>
              <span
                style={{
                  color: "#cbd5e1",
                  fontSize: "0.7rem",
                  fontFamily: "monospace",
                }}
              >
                ₹{fmt(st.price)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {errorMsg && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(255, 93, 93, 0.1)",
            color: "#FF5D5D",
            borderRadius: 6,
            fontSize: "0.8rem",
            margin: "8px 0",
          }}
        >
          NSE Feed Notice: {errorMsg}
        </div>
      )}

      {/* Primary Grid */}
      <div className="grid-main">
        <section className="card gauge-card">
          <h2 className="card-title">COMPOSITE INTRADAY BIAS ⓘ</h2>

          {Gauge ? <Gauge score={finalCompositeScore} /> : null}

          <div className="quick-stats">
            <div className="stat-box">
              <span className="stat-lbl">Live Spot LTP ⓘ</span>
              <span className="stat-num" style={{ color: "#2FD98A" }}>
                ₹{fmt(ind?.latest?.price)}
              </span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Session VWAP ⓘ</span>
              <span className="stat-num">₹{fmt(ind?.latest?.vwap)}</span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Central Pivot (CPR) ⓘ</span>
              <span className="stat-num" style={{ color: "#c084fc" }}>
                ₹{fmt(ind?.cpr?.pivot)}
              </span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Volatility State ⓘ</span>
              <span
                className="stat-num"
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: ind?.bb?.isSqueeze ? "#f97316" : "#2FD98A",
                }}
              >
                {ind?.bb?.isSqueeze ? "⚡ BB SQUEEZE" : "Normal Volatility"}
              </span>
            </div>

            <div className="stat-box full-width">
              <span className="stat-lbl">Opening Range (ORB) ⓘ</span>
              <span className="stat-num orb-state">
                {ind?.orbState || "Inside Range"}
              </span>
            </div>
          </div>
        </section>

        <section className="card price-card">
          <div className="card-header-row">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                justifyContent: "space-between",
                width: "100%",
              }}
            >
              <h2 className="card-title" style={{ margin: 0 }}>
                {selectedTF}M CANDLESTICK STRUCTURE & CPR
              </h2>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 10px",
                  background: `${patternBadgeColor}15`,
                  border: `1px solid ${patternBadgeColor}40`,
                  borderRadius: "6px",
                  fontSize: "0.74rem",
                  fontWeight: 800,
                  color: patternBadgeColor,
                }}
              >
                <span>CANDLE: {candlePattern.name.toUpperCase()}</span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    background: "#0b101b",
                    padding: "1px 5px",
                    borderRadius: "3px",
                    color: "#cbd5e1",
                  }}
                >
                  {candlePattern.type}
                </span>
              </div>
            </div>

            <div className="legend" style={{ marginTop: "8px" }}>
              <span className="leg-item">
                <span className="dot dot-e9" /> EMA 9
              </span>
              <span className="leg-item">
                <span className="dot dot-e21" /> EMA 21
              </span>
              <span className="leg-item">
                <span className="dot dot-vwap" /> VWAP
              </span>
              <span className="leg-item">
                <span className="box box-cpr" /> CPR Band
              </span>
              <span className="leg-item">
                <span className="box box-orb" /> ORB
              </span>
            </div>
          </div>

          {PriceChart ? (
            <PriceChart
              data={data}
              ind={ind}
              score={
                isExecutionTimeframe && marketLive ? finalCompositeScore : 0
              }
            />
          ) : null}
        </section>
      </div>

      {/* Execution Deck */}
      {ind?.latest?.price &&
        (isExecutionTimeframe ? (
          isSetupActive ? (
            <SafeExecutionDeck
              symbol={currentStock.symbol}
              token={currentStock.token}
              exchangeSegment={currentStock.exchangeSegment}
              currentPrice={ind.latest.price}
              side={
                activeTradesRef.current[stockTokenStr]
                  ? activeTradesRef.current[stockTokenStr].side
                  : finalCompositeScore >= 0
                    ? "BUY"
                    : "SELL"
              }
              levels={calculateTradeLevels(
                activeTradesRef.current[stockTokenStr]
                  ? activeTradesRef.current[stockTokenStr].side
                  : finalCompositeScore >= 0
                    ? "BUY"
                    : "SELL",
                ind.latest.price,
                currentAtr,
              )}
              atr={currentAtr}
              score={finalCompositeScore}
              volumeData={{
                current: data[data.length - 1]?.volume || 0,
                average: Math.round(
                  data.slice(-20).reduce((acc, b) => acc + (b.volume || 1), 0) /
                    Math.min(data.length, 20),
                ),
              }}
            />
          ) : (
            <div
              style={{
                marginTop: "16px",
                padding: "16px 20px",
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px dashed #334155",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: indicatorConflict.hasConflict
                      ? "#FF5D5D"
                      : "#64748b",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.82rem",
                    color: "#94a3b8",
                    fontWeight: 600,
                  }}
                >
                  {killSwitchActive
                    ? "🚨 EMERGENCY KILL SWITCH ENABLED // ALL SIGNALS BLOCKED"
                    : indicatorConflict.hasConflict
                      ? indicatorConflict.message
                      : "NEUTRAL CONSOLIDATION // NO ACTIVE 5M CALL"}
                </span>
              </div>
              <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                Score: {finalCompositeScore} pts (Threshold: ±65)
              </span>
            </div>
          )
        ) : (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 18px",
              background: "rgba(245, 184, 65, 0.05)",
              border: "1px dashed rgba(245, 184, 65, 0.3)",
              borderRadius: "8px",
              color: "#F5B841",
              fontSize: "0.78rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>
              ⚠️ <strong>{selectedTF}M VIEW ACTIVE:</strong> Signals locked
              strictly to 5M candles.
            </span>
            <button
              onClick={() => setSelectedTF("5")}
              style={{
                background: "#F5B841",
                color: "#0a0e17",
                border: "none",
                padding: "5px 12px",
                borderRadius: "4px",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: "0.72rem",
              }}
            >
              SWITCH TO 5M
            </button>
          </div>
        ))}

      <AccuracyTracker
        activeAlert={activeAlert}
        currentPrice={ind?.latest?.price}
      />

      {AiRecommendation ? (
        <AiRecommendation
          symbol={currentStock.symbol}
          ind={ind}
          scores={scores}
          atr={currentAtr}
        />
      ) : null}
      <AiAnalystPanel
        symbol={currentStock.symbol}
        score={finalCompositeScore}
        ind={ind}
        pattern={candlePattern}
      />

      {/* Secondary Indicators */}
      <div className="grid-secondary">
        <section className="card indicators-card">
          <h2 className="card-title">INSTITUTIONAL WEIGHTED MATRIX ⓘ</h2>
          <div className="ind-list">
            <TooltipIndicatorBar
              name="VWAP Stretch (22%)"
              score={scores.vwapScore}
              detail={ind?.latest?.vwap ? `₹${fmt(ind.latest.vwap)}` : "—"}
              tooltip="Distance of price from VWAP."
            />
            <TooltipIndicatorBar
              name="9/21 EMA Stack (18%)"
              score={scores.trendScore}
              detail={
                scores.trendScore >= 0 ? "Bullish Stack" : "Bearish Stack"
              }
              tooltip="Fast vs Intermediate trend stacking."
            />
            <TooltipIndicatorBar
              name="MACD Acceleration (18%)"
              score={scores.macdScore}
              detail={fmt(ind?.latest?.hist, 3)}
              tooltip="Momentum speed and histogram velocity."
            />
            <TooltipIndicatorBar
              name="RSI 14 Relative Strength (14%)"
              score={scores.rsiScore}
              detail={fmt(ind?.latest?.rsi, 1)}
              tooltip="Relative strength boundary mapping."
            />
            <TooltipIndicatorBar
              name="CPR Institutional Position (12%)"
              score={scores.cprScore}
              detail={ind?.cprState || "Inside CPR"}
              tooltip="Central Pivot Range positioning."
            />
            <TooltipIndicatorBar
              name="Opening Range Breakout (8%)"
              score={scores.orbScore}
              detail={ind?.orbState || "Inside Range"}
              tooltip="First 15-minute range breach tracking."
            />
            <TooltipIndicatorBar
              name="Relative Volume Surge (8%)"
              score={scores.volScore}
              detail={`${scores.volScore >= 0 ? "+" : ""}${fmt(scores.volScore, 1)} pts`}
              tooltip="Volume comparison against 20-period average."
            />
          </div>
        </section>

        <section className="card oscillators-card">
          <h2 className="card-title">INTRADAY OSCILLATORS</h2>
          <div className="sparkline-group">
            <div className="sparkline-item">
              <div className="spark-header">
                <span>RSI 14 Momentum</span>
                <span>{fmt(ind?.latest?.rsi, 1)}</span>
              </div>
              {MiniChart && (
                <MiniChart
                  values={ind?.rsi14 || []}
                  color="#5B8CFF"
                  w={420}
                  h={52}
                  zeroLine={50}
                  label="RSI"
                />
              )}
            </div>

            <div className="sparkline-item">
              <div className="spark-header">
                <span>MACD Histogram Velocity</span>
                <span>{fmt(ind?.latest?.hist, 3)}</span>
              </div>
              {MiniChart && (
                <MiniChart
                  values={ind?.hist || []}
                  color="#2FD98A"
                  w={420}
                  h={52}
                  zeroLine={0}
                  label="MACD"
                />
              )}
            </div>
          </div>
        </section>
      </div>

      {SignalAlertModal && (
        <SignalAlertModal
          alert={activeAlert}
          onClose={() => setActiveAlert(null)}
        />
      )}
    </main>
  );
}
