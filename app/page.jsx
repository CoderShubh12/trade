"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import Gauge from "@/components/Gauge";
import IndicatorBarComponent, * as IndicatorBarModule from "@/components/IndicatorBar";
import MiniChart from "@/components/MiniChart";
import PriceChart from "@/components/PriceChart";
import SessionStatus from "@/components/SessionStatus";
import AiRecommendation from "@/components/AiRecommendation";
import SignalAlertModal from "@/components/SignalAlertModal";
import StockSearchComponent, * as StockSearchModule from "@/components/StockSearch";
import ExecutionDeckComponent from "@/components/ExecutionDeck";
import {
  computeAll,
  calculateATR,
  calculateTradeLevels,
} from "@/lib/indicators";
import { parseBinaryPacket } from "@/lib/angelStream";
import { fmt, isMarketOpen, playAlertTone } from "@/lib/utils";

// 🛡️ Bulletproof IndicatorBar: Matrix kabhi bhi gayab nahi hogi
const SafeIndicatorBar =
  IndicatorBarComponent ||
  IndicatorBarModule.default ||
  function FallbackIndicatorBar({ name, score = 0, detail = "—" }) {
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
  };

// Safe Search Fallback
const SafeStockSearch =
  StockSearchComponent ||
  StockSearchModule.default ||
  StockSearchModule.StockSearch ||
  (() => <span style={{ color: "#64748b" }}>Search Ready</span>);

// Safe Execution Deck Fallback
const SafeExecutionDeck = ExecutionDeckComponent || (() => null);

const TIMEFRAMES = [
  { label: "1m", value: "1" },
  { label: "3m", value: "3" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
];

export default function DashboardPage() {
  // Reliable default stock (RELIANCE: Segment 1 / Token 2885)
  const [currentStock, setCurrentStock] = useState({
    symbol: "RELIANCE",
    token: "2885",
    exchangeSegment: 1,
  });
  const [selectedTF, setSelectedTF] = useState("5");
  const [data, setData] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [activeAlert, setActiveAlert] = useState(null);
  const lastAlertTime = useRef(0);
  const lastAlertSide = useRef(null);
  const wsRef = useRef(null);

  // 1. Instant Data Load on Mount & Symbol/Timeframe Change
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

  // 2. Real-Time SmartStream WebSocket Subscription (Secure URL)
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
          ws.send(
            JSON.stringify({
              correlationID: "terminal_feed",
              action: 1,
              params: {
                mode: 2,
                tokenList: [
                  {
                    exchangeType: currentStock.exchangeSegment || 1,
                    tokens: [String(currentStock.token)],
                  },
                ],
              },
            }),
          );
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const tick = parseBinaryPacket(event.data);
            if (tick && tick.ltp > 0) {
              setData((prev) => {
                if (!prev || prev.length === 0) return prev;
                const last = prev[prev.length - 1];
                const updatedLast = {
                  ...last,
                  high: Math.max(last.high, tick.ltp),
                  low: Math.min(last.low, tick.ltp),
                  close: tick.ltp,
                };
                return [...prev.slice(0, -1), updatedLast];
              });
            }
          }
        };

        ws.onerror = () => {
          if (isMounted) setWsConnected(false);
        };
        ws.onclose = () => {
          if (isMounted) setWsConnected(false);
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
  }, [currentStock.token]);

  // Compute indicators, BB squeeze, and composite bias
  const ind = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeAll(data, Number(selectedTF));
  }, [data, selectedTF]);

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

  const currentAtr = useMemo(() => {
    return calculateATR(data, 14);
  }, [data]);

  // Check timeframe safety (Noise Filter: Muted on 1m and 3m)
  const isExecutionTimeframe = selectedTF === "5" || selectedTF === "15";

  // Institutional Alert Trigger: Active ONLY during Live Market Hours & on 5m/15m
  useEffect(() => {
    if (!ind?.latest?.price || !data || data.length === 0) return;

    // 🔒 1. 1m aur 3m ke false noise par alert nahi aayega
    if (!isExecutionTimeframe) {
      return;
    }

    // 🔒 2. Market band hone par mute
    if (!isMarketOpen()) {
      return;
    }

    const score = scores.technicalScore;
    const now = Date.now();
    const cooldown = 10 * 60 * 1000;

    if (score >= 65) {
      if (
        lastAlertSide.current !== "BUY" ||
        now - lastAlertTime.current > cooldown
      ) {
        setActiveAlert({
          type: "BUY",
          symbol: currentStock.symbol,
          price: ind.latest.price,
          score,
          vwap: ind.latest.vwap,
          rsi: ind.latest.rsi,
          orbState: ind.orbState,
          atr: currentAtr,
          levels: calculateTradeLevels("BUY", ind.latest.price, currentAtr),
        });

        // 🔊 Institutional Upward Chime Sound
        playAlertTone("BUY");

        lastAlertTime.current = now;
        lastAlertSide.current = "BUY";
      }
    } else if (score <= -65) {
      if (
        lastAlertSide.current !== "SELL" ||
        now - lastAlertTime.current > cooldown
      ) {
        setActiveAlert({
          type: "SELL",
          symbol: currentStock.symbol,
          price: ind.latest.price,
          score,
          vwap: ind.latest.vwap,
          rsi: ind.latest.rsi,
          orbState: ind.orbState,
          atr: currentAtr,
          levels: calculateTradeLevels("SELL", ind.latest.price, currentAtr),
        });

        // 🔊 Institutional Downward Warning Tone
        playAlertTone("SELL");

        lastAlertTime.current = now;
        lastAlertSide.current = "SELL";
      }
    }
  }, [
    scores.technicalScore,
    ind,
    data,
    currentStock,
    currentAtr,
    isExecutionTimeframe,
  ]);

  const marketLive = isMarketOpen();

  return (
    <main className="dashboard-container">
      {/* Header Bar */}
      <header className="dash-header">
        <div
          className="brand-group"
          style={{ display: "flex", alignItems: "center", gap: "10px" }}
        >
          <h1 className="title">NSE INTRADAY BIAS // TERMINAL</h1>
          {SessionStatus ? <SessionStatus /> : null}

          <span
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
            {wsConnected ? "● SMART-STREAM LIVE" : "○ DISCONNECTED"}
          </span>

          {/* Market Status Alert Badge */}
          <span
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background: marketLive
                ? "rgba(47, 217, 138, 0.1)"
                : "rgba(148, 163, 184, 0.1)",
              color: marketLive ? "#2FD98A" : "#94a3b8",
              border: `1px solid ${marketLive ? "#2FD98A40" : "#94a3b830"}`,
              fontWeight: 600,
            }}
          >
            {marketLive ? "MARKET OPEN (ALERTS ON)" : "MARKET CLOSED (MUTED)"}
          </span>

          {/* Tips & Playbook Navigation */}
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
            📖 TIPS & PLAYBOOK
          </Link>
        </div>

        <div
          className="actions-group"
          style={{ display: "flex", alignItems: "center", gap: "12px" }}
        >
          {/* Timeframe Selector */}
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

          {/* Dynamic Autocomplete Stock Search */}
          <SafeStockSearch
            selectedSymbol={currentStock.symbol}
            onSelectStock={(stock) => {
              setData([]);
              setActiveAlert(null);
              setCurrentStock(stock);
            }}
          />

          <span
            className="active-ticker"
            style={{ minWidth: "95px", textAlign: "center" }}
          >
            {currentStock.symbol}
          </span>
        </div>
      </header>

      {/* Error Strip */}
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

      {/* Primary Grid: Gauge & Candlestick Chart */}
      <div className="grid-main">
        <section className="card gauge-card">
          <h2 className="card-title">COMPOSITE INTRADAY BIAS</h2>
          {Gauge ? <Gauge score={scores.technicalScore} /> : null}

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
                {ind?.bb?.isSqueeze
                  ? "⚡ BB SQUEEZE (Coiling)"
                  : "Normal Volatility"}
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
            <h2 className="card-title">
              {selectedTF}M CANDLESTICK STRUCTURE & INSTITUTIONAL CPR
            </h2>
            <div className="legend">
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
                isExecutionTimeframe && marketLive ? scores.technicalScore : 0
              }
            />
          ) : null}
        </section>
      </div>

      {/* Persistent Execution Deck: Enabled on 5m/15m; noise warning on 1m/3m */}
      {ind?.latest?.price &&
        (isExecutionTimeframe ? (
          <SafeExecutionDeck
            symbol={currentStock.symbol}
            currentPrice={ind.latest.price}
            side={scores.technicalScore >= 0 ? "BUY" : "SELL"}
            levels={calculateTradeLevels(
              scores.technicalScore >= 0 ? "BUY" : "SELL",
              ind.latest.price,
              currentAtr,
            )}
            atr={currentAtr}
            score={scores.technicalScore}
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
              ⚠️ <strong>{selectedTF}M MICRO-VIEW ACTIVE:</strong> Signals &
              Execution Levels are muted to prevent whip-saws. Use 5m / 15m for
              trade setups.
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

      {/* Deep Institutional AI Trade Thesis */}
      {AiRecommendation ? (
        <AiRecommendation
          symbol={currentStock.symbol}
          ind={ind}
          scores={scores}
          atr={currentAtr}
        />
      ) : null}

      {/* Secondary Grid: Weighted Indicators Matrix & Oscillators */}
      <div className="grid-secondary">
        <section className="card indicators-card">
          <h2 className="card-title">INSTITUTIONAL WEIGHTED MATRIX</h2>
          <div className="ind-list">
            <SafeIndicatorBar
              name="VWAP Stretch (22%)"
              score={scores.vwapScore}
              detail={ind?.latest?.vwap ? `₹${fmt(ind.latest.vwap)}` : "—"}
            />
            <SafeIndicatorBar
              name="9/21 EMA Stack (18%)"
              score={scores.trendScore}
              detail={
                scores.trendScore >= 0 ? "Bullish Stack" : "Bearish Stack"
              }
            />
            <SafeIndicatorBar
              name="MACD Histogram Acceleration (18%)"
              score={scores.macdScore}
              detail={fmt(ind?.latest?.hist, 3)}
            />
            <SafeIndicatorBar
              name="RSI 14 Relative Strength (14%)"
              score={scores.rsiScore}
              detail={fmt(ind?.latest?.rsi, 1)}
            />
            <SafeIndicatorBar
              name="CPR Institutional Position (12%)"
              score={scores.cprScore}
              detail={ind?.cprState || "Inside CPR"}
            />
            <SafeIndicatorBar
              name="Opening Range Breakout (8%)"
              score={scores.orbScore}
              detail={ind?.orbState || "Inside Range"}
            />
            <SafeIndicatorBar
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

      {/* Signal Trigger Modal */}
      {SignalAlertModal && (
        <SignalAlertModal
          alert={activeAlert}
          onClose={() => setActiveAlert(null)}
        />
      )}
    </main>
  );
}
