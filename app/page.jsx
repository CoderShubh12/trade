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
import AiAnalystPanel from "@/components/AiAnalystPanel";
import { STOCK_POOL } from "@/lib/stockPool";
import {
  computeAll,
  calculateATR,
  calculateTradeLevels,
} from "@/lib/indicators";
import { detectCandlePattern } from "@/lib/candlestickEngine";
import { fmt, playAlertTone } from "@/lib/utils";
import { detectMarketRegime } from "@/lib/marketRegime";
import {
  isStockInCooldown,
  setStockPostLossCooldown,
  checkStockSignalThrottle,
  markStockSignalExecuted,
  checkKillSwitch,
  toggleKillSwitch,
} from "@/lib/advancedGuards";
import { evaluateTradeSetup, monitorActiveTrade } from "@/lib/tradeManager";

const CHARTINK_STRATEGIES = [
  {
    id: "BULLISH_VWAP_CROSS",
    name: "⚡ 5M VWAP + EMA 9/21 Cross",
    description: "Close crosses above VWAP with Bullish EMA Stack & RSI > 55",
    evaluate: (candles) => {
      if (!candles || candles.length < 20) return false;
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
    description: "Opening range breakout with volume > 1.8x of average",
    evaluate: (candles) => {
      if (!candles || candles.length < 15) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.orb || !ind?.latest) return false;
      const { price } = ind.latest;
      const currentVol = candles[candles.length - 1]?.volume || 0;
      const volSlice = candles.slice(-20);
      const avgVol =
        volSlice.reduce((acc, c) => acc + (c.volume || 1), 0) / volSlice.length;
      return price > ind.orb.high && currentVol >= avgVol * 1.8;
    },
  },
  {
    id: "BEARISH_BREAKDOWN",
    name: "🔻 Institutional Short (VWAP Breakdown)",
    description: "Close breaks below Session VWAP & CPR with Bearish MACD",
    evaluate: (candles) => {
      if (!candles || candles.length < 20) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.latest || !ind?.cpr) return false;
      const { price, vwap, hist } = ind.latest;
      const lowerCpr = Math.min(ind.cpr.bc, ind.cpr.tc);
      return price < vwap && price < lowerCpr && hist < 0;
    },
  },
  {
    id: "BB_SQUEEZE_BLAST",
    name: "💥 Bollinger Band Squeeze Blast",
    description: "Volatility breakout after severe band contraction",
    evaluate: (candles) => {
      if (!candles || candles.length < 20) return false;
      const ind = computeAll(candles, 5);
      if (!ind?.bb || !ind?.latest) return false;
      const hadSqueeze = ind.bb.isSqueeze || ind.bb.bandwidth < 1.35;
      const isBreakout = ind.latest.price >= ind.bb.upper;
      return hadSqueeze && isBreakout;
    },
  },
];

function TooltipIndicatorBar({ name, score = 0, detail = "—" }) {
  const safeScore = typeof score === "number" && !isNaN(score) ? score : 0;
  const isPositive = safeScore >= 0;
  const barWidth = Math.min(100, (Math.abs(safeScore) / 25) * 100);
  const color = isPositive ? "#2FD98A" : "#FF5D5D";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "10px 12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "6px",
        marginBottom: "8px",
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
        <span style={{ color: "#cbd5e1", fontWeight: 600 }}>{name}</span>
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
  const [mounted, setMounted] = useState(false);

  const [currentStock, setCurrentStock] = useState({
    symbol: "SBIN",
    token: "3045",
    exchangeSegment: 1,
  });
  const [selectedTF, setSelectedTF] = useState("5");
  const [data, setData] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const [activeTradesState, setActiveTradesState] = useState({});
  const [lockedSignalLevels, setLockedSignalLevels] = useState({});

  const [niftyData, setNiftyData] = useState({
    ltp: 24958.4,
    open: 24920.0,
    change: 38.4,
    changePercent: 0.15,
  });

  const [scannerTicks, setScannerTicks] = useState({});
  const [activeAlert, setActiveAlert] = useState(null);

  const [selectedStrategy, setSelectedStrategy] =
    useState("BULLISH_VWAP_CROSS");
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerMatches, setScreenerMatches] = useState([]);

  const activeTradesRef = useRef({});
  const lastProcessedCandleTime = useRef(null);

  // Client hydration safe initialization
  useEffect(() => {
    setMounted(true);
    try {
      const savedStock = localStorage.getItem("last_active_stock");
      if (savedStock) {
        const parsed = JSON.parse(savedStock);
        if (parsed?.symbol && parsed?.token) setCurrentStock(parsed);
      }

      const savedTrades = localStorage.getItem("terminal_active_trades");
      if (savedTrades) {
        const parsedTrades = JSON.parse(savedTrades);
        activeTradesRef.current = parsedTrades;
        setActiveTradesState(parsedTrades);
      }
    } catch {}
  }, []);

  const syncTrades = (newTrades) => {
    activeTradesRef.current = newTrades;
    setActiveTradesState({ ...newTrades });
    try {
      localStorage.setItem("terminal_active_trades", JSON.stringify(newTrades));
    } catch {}
  };

  const handleStockChange = (stock) => {
    setData([]);
    setActiveAlert(null);
    setCurrentStock(stock);
    try {
      localStorage.setItem("last_active_stock", JSON.stringify(stock));
    } catch {}
  };

  // 1. Angel One Live Market Data Polling (No Fake Ticks)
  useEffect(() => {
    let isMounted = true;

    async function fetchLiveFeed() {
      try {
        const res = await fetch(
          `/api/market-data?token=${currentStock.token}&tf=${selectedTF}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (
          isMounted &&
          json.success &&
          Array.isArray(json.data) &&
          json.data.length > 0
        ) {
          setData(json.data);
          setErrorMsg(null);
        } else if (isMounted && !json.success) {
          setErrorMsg(json.error || "Awaiting Live Exchange Feed...");
        }
      } catch (err) {
        if (isMounted) {
          setErrorMsg("Bridge Connection Offline: Checking Angel API...");
        }
      }
    }

    fetchLiveFeed();
    const livePollingInterval = setInterval(fetchLiveFeed, 2000);

    return () => {
      isMounted = false;
      clearInterval(livePollingInterval);
    };
  }, [currentStock.token, selectedTF]);

  // 2. Fetch Live Nifty 50 Benchmark Data
  useEffect(() => {
    let isMounted = true;

    async function fetchNiftyLive() {
      try {
        const res = await fetch(`/api/market-data?token=26000&tf=5`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (isMounted && json.success && json.data?.length > 0) {
          const bars = json.data;
          const latestBar = bars[bars.length - 1];
          const openPrice = bars[0]?.open || latestBar.open;
          const currentLtp = latestBar.close;
          const diff = currentLtp - openPrice;
          const diffPct = (diff / openPrice) * 100;

          setNiftyData({
            ltp: currentLtp,
            open: openPrice,
            change: diff,
            changePercent: Number(diffPct.toFixed(2)),
          });
        }
      } catch {}
    }

    fetchNiftyLive();
    const niftyInterval = setInterval(fetchNiftyLive, 5000);

    return () => {
      isMounted = false;
      clearInterval(niftyInterval);
    };
  }, []);

  const ind = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeAll(data, Number(selectedTF));
  }, [data, selectedTF]);

  const marketRegime = useMemo(() => detectMarketRegime(data), [data]);
  const candlePattern = useMemo(() => detectCandlePattern(data), [data]);

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

  const finalCompositeScore = useMemo(() => {
    const baseScore = scores.technicalScore || 0;
    const candleBoost = candlePattern?.score || 0;
    return Math.max(
      -100,
      Math.min(100, Math.round(baseScore * 0.8 + candleBoost)),
    );
  }, [scores.technicalScore, candlePattern?.score]);

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

  const niftyBias = useMemo(() => {
    if (niftyData.changePercent <= -0.2) return "BEARISH";
    if (niftyData.changePercent >= 0.2) return "BULLISH";
    return "NEUTRAL";
  }, [niftyData.changePercent]);

  const handleRunChartinkScan = async () => {
    const strat = CHARTINK_STRATEGIES.find((s) => s.id === selectedStrategy);
    if (!strat) return;

    setScreenerLoading(true);
    const matches = [];
    const scanPool = STOCK_POOL.slice(0, 12);

    for (const st of scanPool) {
      try {
        const res = await fetch(`/api/market-data?token=${st.token}&tf=5`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (json.success && json.data?.length >= 15) {
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
      } catch {}
    }

    setScreenerMatches(matches);
    setScreenerLoading(false);
  };

  // Execution & Risk Pilot Engine (Trailing SL, Post-Loss Quarantine, Fixed Targets)
  useEffect(() => {
    if (!ind?.latest?.price || !data || data.length < 2) return;
    if (!isExecutionTimeframe) return;
    if (checkKillSwitch()) return;

    const stockToken = String(currentStock.token);
    const activeTrade = activeTradesRef.current[stockToken];
    const currentPrice = ind.latest.price;
    const vwap = ind.latest.vwap;

    // --- A. ACTIVE TRADE PILOT ---
    if (activeTrade) {
      const status = monitorActiveTrade(activeTrade, currentPrice, vwap);
      if (!status) return;

      // 1. Partial Target 1 Reached: Shift SL to Cost
      if (
        status.isPartial &&
        status.reason === "TARGET_1_HIT_TRAIL_SL_TO_COST"
      ) {
        playAlertTone("BUY");
        setActiveAlert({
          type: "TARGET_HIT",
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          message: `🎯 Target 1 reached! Trailing SL locked to Cost (₹${status.newSl}).`,
        });

        setLockedSignalLevels((prev) => ({
          ...prev,
          [stockToken]: {
            ...prev[stockToken],
            stopLoss: status.newSl,
          },
        }));

        const updated = { ...activeTradesRef.current };
        updated[stockToken] = activeTrade;
        syncTrades(updated);
        return;
      }

      // 2. Full Exits (Target 2, Trailing SL, Stop Loss, 03:15 PM Square-off)
      if (status.exit) {
        const isProfit =
          status.reason === "TARGET_2_HIT" ||
          (status.reason === "TRAILING_SL_HIT" && activeTrade.t1Reached);

        playAlertTone(isProfit ? "BUY" : "SL_HIT");

        setActiveAlert({
          type: isProfit ? "TARGET_HIT" : "SL_HIT",
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          message:
            status.reason === "TARGET_2_HIT"
              ? "🚀 Target 2 reached! Full profit booked."
              : status.reason === "MARKET_CLOSE_SQUAREOFF"
                ? "⏰ 03:15 PM Auto-Square-off executed."
                : status.reason === "TRAILING_SL_HIT"
                  ? "🛡️ Trailing SL hit! Cost protected."
                  : status.reason === "VWAP_BREACH_EXIT"
                    ? "⚠️ VWAP buffer breached. Risk cut."
                    : "🛑 Position closed: " + status.reason,
        });

        if (!isProfit) {
          setStockPostLossCooldown(stockToken, 45);
        }

        const updated = { ...activeTradesRef.current };
        delete updated[stockToken];
        syncTrades(updated);
        return;
      }

      return;
    }

    // --- B. NEW SETUP EVALUATION ---
    const quarantine = isStockInCooldown(stockToken);
    if (quarantine.inCooldown) return;

    const throttle = checkStockSignalThrottle(stockToken, 5);
    if (!throttle.allowed) return;

    const completedCandle = data[data.length - 2];
    if (
      !completedCandle ||
      completedCandle.time === lastProcessedCandleTime.current
    ) {
      return;
    }

    async function executeSignalCheck() {
      if (Math.abs(finalCompositeScore) < 65) return;

      const setup = await evaluateTradeSetup(
        finalCompositeScore,
        niftyBias,
        completedCandle,
        vwap,
        currentAtr,
        {
          bypassTimeWindow: true,
          useGroqValidation: false,
          symbol: currentStock.symbol,
          timeframe: selectedTF,
          regime: marketRegime,
        },
      );

      if (setup && (setup.action === "BUY" || setup.action === "SELL")) {
        lastProcessedCandleTime.current = completedCandle.time;
        markStockSignalExecuted(stockToken);

        const newTradeRecord = {
          side: setup.action,
          action: setup.action,
          entry: setup.entry,
          target1: setup.target1,
          target2: setup.target2,
          sl: setup.stopLoss,
          stopLoss: setup.stopLoss,
          initialSl: setup.initialSl,
          t1Reached: false,
          startTime: Date.now(),
          maxTime: setup.maxTime,
        };

        // 🔒 Freeze levels in state so they never change on subsequent ticks
        setLockedSignalLevels((prev) => ({
          ...prev,
          [stockToken]: {
            entry: setup.entry,
            stopLoss: setup.stopLoss,
            target1: setup.target1,
            target2: setup.target2,
            rrRatio: "1:2.1",
          },
        }));

        const updated = { ...activeTradesRef.current };
        updated[stockToken] = newTradeRecord;
        syncTrades(updated);

        setActiveAlert({
          type: setup.action,
          symbol: currentStock.symbol,
          price: setup.entry,
          score: finalCompositeScore,
          pattern: candlePattern?.name || "PRICE_ACTION",
          vwap,
          rsi: ind.latest.rsi,
          levels: {
            entry: setup.entry,
            stopLoss: setup.stopLoss,
            target1: setup.target1,
            target2: setup.target2,
          },
        });

        playAlertTone(setup.action);
      }
    }

    executeSignalCheck();
  }, [
    finalCompositeScore,
    ind,
    data,
    currentStock,
    currentAtr,
    isExecutionTimeframe,
    niftyBias,
    marketRegime,
    candlePattern,
  ]);

  const stockTokenStr = String(currentStock.token);
  const activeTradeInstance = activeTradesState[stockTokenStr];
  const stockQuarantineStatus = mounted
    ? isStockInCooldown(stockTokenStr)
    : { inCooldown: false };

  const isSetupActive =
    !killSwitchActive &&
    (Math.abs(finalCompositeScore) >= 65 || !!activeTradeInstance);

  // 🔒 Closed-candle anchored trade levels (Insulated against live tick recalculations)
  const frozenTradeLevels = useMemo(() => {
    if (activeTradeInstance) {
      return {
        entry: activeTradeInstance.entry,
        stopLoss: activeTradeInstance.stopLoss,
        target1: activeTradeInstance.target1,
        target2: activeTradeInstance.target2,
        rrRatio: "1:2.1",
      };
    }

    if (lockedSignalLevels[stockTokenStr]) {
      return lockedSignalLevels[stockTokenStr];
    }

    const closedCandle =
      data && data.length >= 2 ? data[data.length - 2] : null;
    const fixedAnchor = closedCandle?.close || (data && data[0]?.close) || 100;

    const levels = calculateTradeLevels(
      finalCompositeScore >= 0 ? "BUY" : "SELL",
      fixedAnchor,
      currentAtr,
    );

    return {
      entry: fixedAnchor,
      stopLoss: levels.sl,
      target1: levels.t1,
      target2: levels.t2,
      rrRatio: levels.rrRatio,
    };
  }, [
    activeTradeInstance,
    lockedSignalLevels,
    stockTokenStr,
    data && data.length >= 2 ? data[data.length - 2]?.time : null,
    finalCompositeScore >= 0,
    currentAtr,
  ]);

  const patternBadgeColor = candlePattern?.bias?.includes("BULLISH")
    ? "#2FD98A"
    : candlePattern?.bias?.includes("BEARISH")
      ? "#FF5D5D"
      : "#94a3b8";

  // Hydration safety barrier
  if (!mounted) {
    return (
      <main
        className="dashboard-container"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}
      >
        <div
          style={{
            color: "#38bdf8",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            letterSpacing: "1px",
          }}
        >
          INITIALIZING NSE QUANT TERMINAL V2 (ANGEL ONE LIVE)...
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-container">
      <header className="dash-header">
        <div
          className="brand-group"
          style={{ display: "flex", alignItems: "center", gap: "10px" }}
        >
          <h1 className="title">NSE INTRADAY BIAS // TERMINAL V2</h1>
          {SessionStatus ? <SessionStatus /> : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "3px 9px",
              borderRadius: 4,
              background: "#0f172a",
              border: `1px solid ${niftyData.change >= 0 ? "#2FD98A40" : "#FF5D5D40"}`,
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
              {fmt(niftyData.ltp)}
            </span>
            <span
              style={{
                fontSize: "0.68rem",
                color: niftyData.change >= 0 ? "#2FD98A" : "#FF5D5D",
              }}
            >
              ({niftyData.change >= 0 ? "+" : ""}
              {fmt(niftyData.changePercent, 2)}%)
            </span>
          </div>

          <span
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background: "rgba(47, 217, 138, 0.15)",
              color: "#2FD98A",
              border: "1px solid #2FD98A",
              fontWeight: 700,
            }}
          >
            ● ANGEL ONE LIVE
          </span>

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
          <div className="tf-group">
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
            className="active-ticker"
            style={{ minWidth: "95px", textAlign: "center" }}
          >
            {currentStock.symbol}
          </span>
        </div>
      </header>

      {/* Quarantine Status Banner */}
      {stockQuarantineStatus.inCooldown && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 14px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid #ef4444",
            borderRadius: 6,
            color: "#f87171",
            fontSize: "0.78rem",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            🛡️ POST-LOSS LOCKOUT: {currentStock.symbol} is quarantined for{" "}
            {stockQuarantineStatus.remainingMins}m to prevent rapid-fire losses.
          </span>
          <span style={{ fontSize: "0.7rem", color: "#fca5a5" }}>
            SIGNALS MUTED
          </span>
        </div>
      )}

      <PriceBandScanner
        stocks={STOCK_POOL}
        marketTicks={scannerTicks}
        activeSymbol={currentStock.symbol}
        onSelectStock={handleStockChange}
      />

      {/* Chartink Screener */}
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
          <span
            style={{ fontSize: "0.82rem", fontWeight: 800, color: "#38bdf8" }}
          >
            📊 INTRADAY SCANNER (CHARTINK ENGINE)
          </span>

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
          Notice: {errorMsg}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid-main">
        <section className="card gauge-card">
          <h2 className="card-title">COMPOSITE INTRADAY BIAS</h2>
          {Gauge ? <Gauge score={finalCompositeScore} /> : null}

          <div className="quick-stats">
            <div className="stat-box">
              <span className="stat-lbl">Live Spot LTP</span>
              <span className="stat-num" style={{ color: "#2FD98A" }}>
                ₹{fmt(ind?.latest?.price)}
              </span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Session VWAP</span>
              <span className="stat-num">₹{fmt(ind?.latest?.vwap)}</span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Central Pivot (CPR)</span>
              <span className="stat-num" style={{ color: "#c084fc" }}>
                ₹{fmt(ind?.cpr?.pivot)}
              </span>
            </div>

            <div className="stat-box">
              <span className="stat-lbl">Volatility State</span>
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
              <span className="stat-lbl">Opening Range (ORB)</span>
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
                <span>
                  CANDLE: {(candlePattern?.name || "NONE").toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: "0.65rem",
                    background: "#0b101b",
                    padding: "1px 5px",
                    borderRadius: "3px",
                    color: "#cbd5e1",
                  }}
                >
                  {candlePattern?.type || "NEUTRAL"}
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
            <PriceChart data={data} ind={ind} score={finalCompositeScore} />
          ) : null}
        </section>
      </div>

      {/* Execution Deck: Stabilized against tick flickering */}
      {ind?.latest?.price && isExecutionTimeframe && isSetupActive && (
        <SafeExecutionDeck
          symbol={currentStock.symbol}
          token={currentStock.token}
          exchangeSegment={currentStock.exchangeSegment}
          currentPrice={ind.latest.price}
          entryPrice={activeTradeInstance?.entry || frozenTradeLevels.entry}
          side={
            activeTradeInstance
              ? activeTradeInstance.side
              : finalCompositeScore >= 0
                ? "BUY"
                : "SELL"
          }
          levels={{
            entry: activeTradeInstance
              ? activeTradeInstance.entry
              : frozenTradeLevels.entry,
            stopLoss: activeTradeInstance
              ? activeTradeInstance.stopLoss
              : frozenTradeLevels.stopLoss,
            target1: activeTradeInstance
              ? activeTradeInstance.target1
              : frozenTradeLevels.target1,
            target2: activeTradeInstance
              ? activeTradeInstance.target2
              : frozenTradeLevels.target2,
          }}
          atr={currentAtr}
          score={finalCompositeScore}
          isLiveTrade={!!activeTradeInstance}
          volumeData={{
            current: data[data.length - 1]?.volume || 0,
            average: Math.round(
              data.slice(-20).reduce((acc, b) => acc + (b.volume || 1), 0) /
                Math.min(data.length, 20),
            ),
          }}
        />
      )}

      <AccuracyTracker
        activeAlert={activeAlert}
        currentPrice={ind?.latest?.price}
      />

      {AiRecommendation ? (
        <AiRecommendation
          symbol={currentStock.symbol}
          ind={ind}
          scores={scores}
          score={finalCompositeScore}
          timeframe={selectedTF}
          pattern={candlePattern}
          regime={marketRegime}
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
          <h2 className="card-title">INSTITUTIONAL WEIGHTED MATRIX</h2>
          <div className="ind-list">
            <TooltipIndicatorBar
              name="VWAP Stretch (22%)"
              score={scores.vwapScore}
              detail={ind?.latest?.vwap ? `₹${fmt(ind.latest.vwap)}` : "—"}
            />
            <TooltipIndicatorBar
              name="9/21 EMA Stack (18%)"
              score={scores.trendScore}
              detail={
                scores.trendScore >= 0 ? "Bullish Stack" : "Bearish Stack"
              }
            />
            <TooltipIndicatorBar
              name="MACD Acceleration (18%)"
              score={scores.macdScore}
              detail={fmt(ind?.latest?.hist, 3)}
            />
            <TooltipIndicatorBar
              name="RSI 14 Relative Strength (14%)"
              score={scores.rsiScore}
              detail={fmt(ind?.latest?.rsi, 1)}
            />
            <TooltipIndicatorBar
              name="CPR Institutional Position (12%)"
              score={scores.cprScore}
              detail={ind?.cprState || "Inside CPR"}
            />
            <TooltipIndicatorBar
              name="Opening Range Breakout (8%)"
              score={scores.orbScore}
              detail={ind?.orbState || "Inside Range"}
            />
            <TooltipIndicatorBar
              name="Relative Volume Surge (8%)"
              score={scores.volScore}
              detail={`${scores.volScore >= 0 ? "+" : ""}${fmt(scores.volScore, 1)} pts`}
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
