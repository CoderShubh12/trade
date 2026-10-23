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
import CurrentCallCard from "@/components/CurrentCallCard";
import TradeLog from "@/components/TradeLog";
import WatchlistPanel from "@/components/WatchlistPanel";
import FundamentalsPanel from "@/components/FundamentalsPanel";
import { STOCK_POOL } from "@/lib/stockPool";
import {
  computeAll,
  calculateATR,
  calculateTradeLevels,
} from "@/lib/indicators";
import { detectCandlePattern } from "@/lib/candlestickEngine";
import { buildCompositeScore } from "@/lib/signalEngine";
import {
  newSignalMemory,
  observeScore,
  checkSignalAllowed,
  recordEntry,
  recordExit,
} from "@/lib/signalMemory";
import {
  getClosedCandles,
  getLiveSignalGate,
  getIstParts,
  getSessionInfo,
  isMarketOpenIST,
  isDataFresh,
  getTradeWindowStatus,
} from "@/lib/sessionUtils";
import { fmt, playAlertTone, formatRiskReward } from "@/lib/utils";
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
      if (!ind?.orb || !ind?.latest || !ind.orComplete) return false; // range must be closed
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

const replayBtnStyle = {
  fontSize: "0.72rem",
  padding: "3px 10px",
  borderRadius: 4,
  background: "#0f172a",
  color: "#fbbf24",
  border: "1px solid #fbbf24",
  fontWeight: 700,
  cursor: "pointer",
};

// 09:30-style clock text from a timestamp (IST)
const hhmmStr = (ms) => {
  const h = getIstParts(ms).hhmm;
  return `${String(Math.floor(h / 100)).padStart(2, "0")}:${String(h % 100).padStart(2, "0")}`;
};

// Short headline for an exit alert, so the title always matches what happened
const EXIT_TITLES = {
  TARGET_2_HIT: "🚀 TARGET 2 HIT",
  TRAILING_SL_HIT: "🛡️ TRAILING STOP HIT",
  STOP_LOSS_HIT: "🛑 STOP LOSS HIT",
  VWAP_BREACH_EXIT: "⚠️ VWAP EXIT",
  TIME_DECAY_TIMEOUT: "⌛ TIME EXIT (25 min)",
  MARKET_CLOSE_SQUAREOFF: "⏰ 3:15 PM SQUARE-OFF",
};

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
  // rawData = candles exactly as Angel One returned them (several days).
  // data    = what the dashboard shows: rawData in LIVE mode, or rawData cut at
  //           the replay cursor in REPLAY mode.
  const [rawData, setRawData] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [thinFeed, setThinFeed] = useState(0); // >0 = only that many tick-built bars exist (Angel candles refused); no signals until 25

  // LIVE = real feed. REPLAY = a past real session played candle by candle
  // (works when the market is closed; clearly labelled, never mixed with live).
  const [mode, setMode] = useState("LIVE");
  const [replayCount, setReplayCount] = useState(1); // candles revealed so far
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayDelayMs, setReplayDelayMs] = useState(700);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const [activeTradesState, setActiveTradesState] = useState({});
  const [lockedSignalLevels, setLockedSignalLevels] = useState({});

  // Real Nifty candles (no placeholder price: until the feed answers it is empty)
  const [niftyBars, setNiftyBars] = useState([]);

  const [scannerTicks, setScannerTicks] = useState({});
  const [activeAlert, setActiveAlert] = useState(null);

  const [selectedStrategy, setSelectedStrategy] =
    useState("BULLISH_VWAP_CROSS");
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerMatches, setScreenerMatches] = useState([]);

  const activeTradesRef = useRef({});
  const lastProcessedCandleKey = useRef(null); // "token:candleTime"
  const modeRef = useRef("LIVE");
  // Remembers, per stock, whether a call was already given (see signalMemory.js)
  const signalMemoryRef = useRef({});
  const [signalNote, setSignalNote] = useState(null); // why no new call right now

  // ---- UI state: side panel, big chart, trade log, watchlist ------------
  const [panelTab, setPanelTab] = useState("CALL");
  const [bigChart, setBigChart] = useState(false);
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  const [tradeLog, setTradeLog] = useState([]); // every call + its exit
  const [watchlist, setWatchlist] = useState([]);
  const [wlLoading, setWlLoading] = useState(true);
  const [wlError, setWlError] = useState(null);
  const tfNum = Number(selectedTF);

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
        // An intraday trade can never survive overnight: drop old-day trades
        const todayIst = getIstParts().dateStr;
        const freshTrades = {};
        Object.entries(parsedTrades).forEach(([tok, tr]) => {
          if (tr?.startTime && getIstParts(tr.startTime).dateStr === todayIst) {
            freshTrades[tok] = tr;
          }
        });
        activeTradesRef.current = freshTrades;
        setActiveTradesState(freshTrades);
        localStorage.setItem(
          "terminal_active_trades",
          JSON.stringify(freshTrades),
        );
      }
    } catch {}

    // Today's LIVE call log (practice/replay calls are never saved)
    try {
      const todayIst = getIstParts().dateStr;
      const savedLog = JSON.parse(localStorage.getItem("terminal_trade_log") || "[]");
      setTradeLog(savedLog.filter((t) => t.dateStr === todayIst && !t.isReplay));
    } catch {}
  }, []);

  // Viewport size (drives the chart height) + Esc closes the big chart
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    const onKey = (e) => e.key === "Escape" && setBigChart(false);
    window.addEventListener("resize", update);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Paper journal: send every LIVE call (and its exit) to the server file, once per change
  const journalSent = useRef(new Set());
  // When the SERVER engine is on it records calls/exits itself; this page must not journal the same call again.
  const serverEngineOn = useRef(false);
  useEffect(() => {
    // Re-check every 30 s: the engine can be switched on/off or the server restarted while this tab stays open.
    const check = () => fetch("/api/engine").then((r) => r.json()).then((j) => { serverEngineOn.current = !!(j && j.enabled); }).catch(() => {});
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (serverEngineOn.current) return;
    tradeLog.forEach((t) => {
      if (t.isReplay) return;
      const sig = `${t.id}|${t.exitPrice ?? ""}`;
      if (journalSent.current.has(sig)) return;
      journalSent.current.add(sig);
      fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) }).catch(() => journalSent.current.delete(sig));
    });
  }, [tradeLog]);

  // News tag (real headlines tagged by Groq) -> stored with each call as an ML feature. Shadow only; never blocks a call.
  const newsRef = useRef({ symbol: "", tag: null });
  useEffect(() => {
    if (mode === "REPLAY" || !currentStock?.symbol) return;
    let dead = false;
    const sym = currentStock.symbol;
    const load = () =>
      fetch(`/api/news?symbol=${encodeURIComponent(sym)}`)
        .then((r) => r.json())
        .then((j) => { if (!dead) newsRef.current = { symbol: sym, tag: j && j.available ? j : null }; })
        .catch(() => {});
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { dead = true; clearInterval(id); };
  }, [currentStock?.symbol, mode]);

  // Save only LIVE calls of today
  useEffect(() => {
    try {
      const live = tradeLog.filter((t) => !t.isReplay);
      localStorage.setItem("terminal_trade_log", JSON.stringify(live));
    } catch {}
  }, [tradeLog]);

  // Watchlist lives on the server (data/watchlist.json)
  const loadWatchlist = async () => {
    try {
      const r = await fetch("/api/watchlist", { cache: "no-store" });
      const j = await r.json();
      if (j.success) {
        setWatchlist(j.items);
        setWlError(null);
      } else setWlError(j.error || "Could not load watchlist");
    } catch {
      setWlError("Could not reach the watchlist service");
    }
    setWlLoading(false);
  };
  useEffect(() => {
    loadWatchlist();
  }, []);

  const addToWatchlist = async (item) => {
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const j = await r.json();
      if (j.success) {
        setWatchlist(j.items);
        setWlError(null);
      } else setWlError(j.error || "Could not save");
    } catch {
      setWlError("Could not reach the watchlist service");
    }
  };

  const removeFromWatchlist = async (token) => {
    try {
      const r = await fetch(`/api/watchlist?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (j.success) setWatchlist(j.items);
    } catch {
      setWlError("Could not reach the watchlist service");
    }
  };

  const isInWatchlist = (token) =>
    watchlist.some((w) => w.token === String(token));

  // Has THIS call (same entry price) already been saved with its levels?
  const isCallSaved = (token, entry) =>
    watchlist.some(
      (w) =>
        w.token === String(token) &&
        w.source === "CALL" &&
        Math.abs((w.entry || 0) - (entry || 0)) < 0.005,
    );

  const syncTrades = (newTrades) => {
    activeTradesRef.current = newTrades;
    setActiveTradesState({ ...newTrades });
    // REPLAY trades are practice only: never written to the live trade store
    if (modeRef.current !== "LIVE") return;
    try {
      localStorage.setItem("terminal_active_trades", JSON.stringify(newTrades));
    } catch {}
  };

  const handleStockChange = (stock) => {
    setRawData([]);
    setActiveAlert(null);
    setReplayCount(1);
    setReplayPlaying(false);
    lastProcessedCandleKey.current = null;
    setCurrentStock(stock);
    try {
      localStorage.setItem("last_active_stock", JSON.stringify(stock));
    } catch {}
  };

  // 1. Angel One market data. LIVE polls every 2s. REPLAY loads once
  //    (the past session does not change, so no need to hit the API).
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
          setRawData(json.data);
          setThinFeed(json.tickBuilt && json.data.length < 12 ? json.data.length : 0);
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
    if (mode === "REPLAY") {
      return () => {
        isMounted = false;
      };
    }
    // price ticks come from /api/ltp every second; candles only need a slow refresh
    const livePollingInterval = setInterval(fetchLiveFeed, 8000);

    return () => {
      isMounted = false;
      clearInterval(livePollingInterval);
    };
  }, [currentStock.token, selectedTF, mode]);

  // 1b. Streamed price (Angel WebSocket, read from our server once a second).
  //     Used only to keep the LAST candle's close/high/low moving between candle refreshes.
  const [liveTick, setLiveTick] = useState(null); // { token, ltp, at }
  const [niftyTick, setNiftyTick] = useState(null); // { ltp, at }
  useEffect(() => {
    if (mode === "REPLAY") { setLiveTick(null); setNiftyTick(null); return; }
    let on = true;
    const tokenNow = String(currentStock.token);
    async function pollTick() {
      try {
        const r = await fetch(`/api/ltp?tokens=${tokenNow},99926000`, { cache: "no-store" });
        const j = await r.json();
        const x = j?.ticks?.[tokenNow];
        const n = j?.ticks?.["99926000"];
        if (on && x && x.ageMs < 5000) setLiveTick({ token: tokenNow, ltp: x.ltp, at: Date.now() });
        else if (on) setLiveTick(null);
        if (on && n && n.ageMs < 5000) setNiftyTick({ ltp: n.ltp, at: Date.now() });
        else if (on) setNiftyTick(null);
      } catch { if (on) { setLiveTick(null); setNiftyTick(null); } }
    }
    pollTick();
    const iv = setInterval(pollTick, 1000);
    return () => { on = false; clearInterval(iv); };
  }, [currentStock.token, mode]);

  // 2. Nifty 50 candles (benchmark for the market-bias filter)
  useEffect(() => {
    let isMounted = true;

    // Angel One lists the Nifty 50 index as token 99926000 (older token 26000
    // kept as a fallback). First one that returns candles wins.
    async function fetchNiftyLive() {
      for (const token of ["99926000", "26000"]) {
        try {
          const res = await fetch(`/api/market-data?token=${token}&tf=5`, {
            cache: "no-store",
          });
          const json = await res.json();
          if (json.success && json.data?.length > 0) {
            if (isMounted) setNiftyBars(json.data);
            return;
          }
        } catch {}
      }
    }

    fetchNiftyLive();
    if (mode === "REPLAY") {
      return () => {
        isMounted = false;
      };
    }
    const niftyInterval = setInterval(fetchNiftyLive, 20000);

    return () => {
      isMounted = false;
      clearInterval(niftyInterval);
    };
  }, [mode]);

  // ---- REPLAY: which past session do we play? -------------------------
  // The latest COMPLETED session in the fetched candles (earlier days
  // before it stay in the array as indicator history).
  const replaySession = useMemo(() => {
    if (!rawData.length) return null;
    const nowIst = getIstParts();
    let end = rawData.length; // exclusive
    // If the newest session is today and still running, replay the one before
    const info = getSessionInfo(rawData);
    const todayRunning =
      info.today.length > 0 &&
      info.today[0].date === nowIst.dateStr &&
      nowIst.hhmm < 1530 &&
      nowIst.day !== 0 &&
      nowIst.day !== 6;
    if (todayRunning) {
      if (!info.hasPrevSession) return null;
      end = info.startIdx;
    }
    const sessionCandles = getSessionInfo(rawData.slice(0, end));
    return {
      date: sessionCandles.today[0]?.date,
      startIdx: sessionCandles.startIdx,
      length: sessionCandles.today.length,
    };
  }, [rawData]);

  // What the dashboard actually works on
  const data = useMemo(() => {
    if (mode !== "REPLAY") {
      // overlay the streamed price on the newest candle (same candle only, sane price only)
      const last = rawData[rawData.length - 1];
      if (
        liveTick && last && liveTick.token === String(currentStock.token) &&
        Date.now() - liveTick.at < 5000 &&
        Math.abs(liveTick.ltp / last.close - 1) < 0.05 &&
        Date.now() >= last.time * 1000 && Date.now() < last.time * 1000 + (Number(selectedTF) + 1) * 60000
      ) {
        const patched = {
          ...last, close: liveTick.ltp,
          high: Math.max(last.high, liveTick.ltp), low: Math.min(last.low, liveTick.ltp),
        };
        return [...rawData.slice(0, -1), patched];
      }
      return rawData;
    }
    if (!replaySession) return [];
    const shown = Math.min(Math.max(replayCount, 1), replaySession.length);
    return rawData.slice(0, replaySession.startIdx + shown);
  }, [mode, rawData, replaySession, replayCount, liveTick, currentStock.token, selectedTF]);

  // Virtual clock for REPLAY = the moment the newest revealed candle closed.
  const virtualNowMs =
    mode === "REPLAY" && data.length
      ? data[data.length - 1].time * 1000 + tfNum * 60 * 1000
      : null;

  // Nifty at the same moment (live: latest; replay: up to the virtual clock)
  const niftyData = useMemo(() => {
    if (!niftyBars.length) return null;
    const bars =
      virtualNowMs === null
        ? niftyBars
        : niftyBars.filter((b) => b.time * 1000 + 5 * 60 * 1000 <= virtualNowMs);
    if (!bars.length) return null;
    const todayBars = getSessionInfo(bars).today;
    const openPrice = todayBars[0]?.open || bars[bars.length - 1].open;
    let currentLtp = bars[bars.length - 1].close;
    if (virtualNowMs === null && niftyTick && Date.now() - niftyTick.at < 5000 && Math.abs(niftyTick.ltp / currentLtp - 1) < 0.03) {
      currentLtp = niftyTick.ltp; // streamed price, only in LIVE mode
    }
    const diff = currentLtp - openPrice;
    return {
      ltp: currentLtp,
      open: openPrice,
      change: diff,
      changePercent: Number(((diff / openPrice) * 100).toFixed(2)),
    };
  }, [niftyBars, virtualNowMs, niftyTick]);

  // Dashboard values (live gauge: uses every candle, including the forming one)
  const ind = useMemo(() => {
    if (!data || data.length === 0) return null;
    return computeAll(data, tfNum);
  }, [data, tfNum]);

  const marketRegime = useMemo(() => detectMarketRegime(data), [data]);
  const candlePattern = useMemo(
    () => detectCandlePattern(data, { lastIsClosed: mode === "REPLAY" }),
    [data, mode],
  );

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

  // ---- The score that is allowed to fire a signal -----------------------
  // Built ONLY from fully closed candles, so a signal never repaints and
  // never depends on a half-finished candle.
  const signalData = useMemo(
    () => getClosedCandles(data, tfNum, virtualNowMs ?? Date.now()),
    [data, tfNum, virtualNowMs],
  );
  const signalBasis = useMemo(
    () => buildCompositeScore(signalData, tfNum, true),
    [signalData, tfNum],
  );
  const signalScore = signalBasis.score;
  const signalAtr = useMemo(() => calculateATR(signalData, 14), [signalData]);

  // No Nifty candles yet -> NEUTRAL (the filter simply does not block)
  const niftyBias = useMemo(() => {
    if (!niftyData) return "NEUTRAL";
    if (niftyData.changePercent <= -0.2) return "BEARISH";
    if (niftyData.changePercent >= 0.2) return "BULLISH";
    return "NEUTRAL";
  }, [niftyData]);

  // Is it allowed to produce signals right now?
  const signalGate = useMemo(() => {
    if (mode === "REPLAY") {
      const w = getTradeWindowStatus(virtualNowMs ?? Date.now());
      return { allowed: true, inWindow: w.allowed, reason: w.reason };
    }
    const g = getLiveSignalGate(rawData, tfNum);
    const w = getTradeWindowStatus();
    if (thinFeed > 0) return { allowed: false, inWindow: w.allowed, windowReason: w.reason, reason: `Only ${thinFeed} tick-built bars so far (need 12) - signals paused` };
    return { ...g, inWindow: w.allowed, windowReason: w.reason };
  }, [mode, rawData, tfNum, virtualNowMs, thinFeed]);

  // Honest feed badge (replaces the old always-green "ANGEL ONE LIVE")
  const feedBadge = useMemo(() => {
    if (mode === "REPLAY") {
      const last = data[data.length - 1];
      return {
        text: `▶ REPLAY ${last?.date || ""} ${last?.clock || ""} IST`,
        color: "#fbbf24",
      };
    }
    if (!rawData.length) return { text: "○ NO DATA", color: "#94a3b8" };
    const now = Date.now();
    if (!isMarketOpenIST(now)) {
      return { text: "○ MARKET CLOSED · LAST SESSION DATA", color: "#94a3b8" };
    }
    if (!isDataFresh(rawData, tfNum, now)) {
      return { text: "⚠ STALE FEED", color: "#FF5D5D" };
    }
    return { text: liveTick ? "● LIVE · TICK STREAM" : "● LIVE · FEED OK", color: "#2FD98A" };
  }, [mode, rawData, data, tfNum, liveTick]);

  // ---- Mode + replay controls -------------------------------------------
  const restartReplay = () => {
    setReplayPlaying(false);
    setReplayCount(1);
    setActiveAlert(null);
    setLockedSignalLevels({});
    activeTradesRef.current = {};
    setActiveTradesState({});
    lastProcessedCandleKey.current = null;
    signalMemoryRef.current = {};
    setSignalNote(null);
    setTradeLog((prev) => prev.filter((t) => !t.isReplay));
  };

  const switchMode = (nextMode) => {
    if (nextMode === mode) return;
    setTradeLog((prev) => prev.filter((t) => !t.isReplay)); // practice log starts fresh
    modeRef.current = nextMode;
    setMode(nextMode);
    setReplayPlaying(false);
    setReplayCount(1);
    setActiveAlert(null);
    setLockedSignalLevels({});
    lastProcessedCandleKey.current = null;
    signalMemoryRef.current = {};
    setSignalNote(null);
    if (nextMode === "REPLAY") {
      // practice trades start empty and are never saved
      activeTradesRef.current = {};
      setActiveTradesState({});
    } else {
      // back to live: reload the real saved trades
      try {
        const saved = JSON.parse(
          localStorage.getItem("terminal_active_trades") || "{}",
        );
        activeTradesRef.current = saved;
        setActiveTradesState(saved);
      } catch {
        activeTradesRef.current = {};
        setActiveTradesState({});
      }
    }
  };

  // Replay timer: reveal one more candle every `replayDelayMs`
  useEffect(() => {
    if (mode !== "REPLAY" || !replayPlaying || !replaySession) return;
    const id = setInterval(() => {
      setReplayCount((c) => {
        if (c >= replaySession.length) {
          setReplayPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, replayDelayMs);
    return () => clearInterval(id);
  }, [mode, replayPlaying, replayDelayMs, replaySession]);

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

    const isReplay = mode === "REPLAY";
    // REPLAY uses the virtual clock, LIVE uses the real one
    const nowMs = virtualNowMs ?? Date.now();

    const stockToken = String(currentStock.token);
    const activeTrade = activeTradesRef.current[stockToken];
    const currentPrice = ind.latest.price;
    const vwap = ind.latest.vwap;

    // "One call per setup": keep track of whether this stock already got a call
    const memKey = `${isReplay ? "R" : "L"}:${stockToken}`;
    const dayKey = getIstParts(nowMs).dateStr;
    signalMemoryRef.current[memKey] = observeScore(
      signalMemoryRef.current[memKey],
      signalScore,
      dayKey,
    );

    // --- A. ACTIVE TRADE PILOT ---
    // (also runs when the market is closed, so an old trade is always closed out)
    if (activeTrade) {
      const status = monitorActiveTrade(activeTrade, currentPrice, vwap, nowMs);
      if (!status) return;

      // 1. Partial Target 1 Reached: Shift SL to Cost
      if (
        status.isPartial &&
        status.reason === "TARGET_1_HIT_TRAIL_SL_TO_COST"
      ) {
        playAlertTone("BUY");
        setActiveAlert({
          type: "TARGET_HIT",
          title: "🎯 TARGET 1 HIT · stop moved to cost",
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          isReplay,
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
        // Profit is decided by the real result, not only by the exit reason
        // (a VWAP exit or square-off can be in profit - no cooldown then).
        const direction = activeTrade.action === "SELL" ? -1 : 1;
        const pnlPerShare = direction * (currentPrice - activeTrade.entry);
        const isProfit =
          status.reason === "TARGET_2_HIT" ||
          (status.reason === "TRAILING_SL_HIT" && activeTrade.t1Reached) ||
          pnlPerShare > 0;

        playAlertTone(isProfit ? "BUY" : "SL_HIT");

        // Result in R (1R = distance from entry to the first stop)
        const riskPerShare =
          Math.abs(activeTrade.entry - (activeTrade.initialSl ?? activeTrade.stopLoss)) || 1;
        const rResult = pnlPerShare / riskPerShare;
        const exitTitle =
          (EXIT_TITLES[status.reason] || "POSITION CLOSED") +
          ` · ${rResult >= 0 ? "+" : "−"}${Math.abs(rResult).toFixed(2)}R`;

        setTradeLog((prev) =>
          prev.map((t) =>
            t.id === activeTrade.logId
              ? {
                  ...t,
                  exitPrice: currentPrice,
                  exitClock: hhmmStr(nowMs),
                  reason: status.reason,
                  r: rResult,
                }
              : t,
          ),
        );

        setActiveAlert({
          type: isProfit ? "TARGET_HIT" : "SL_HIT",
          title: exitTitle,
          symbol: currentStock.symbol,
          exitPrice: currentPrice,
          isReplay,
          message:
            status.reason === "TARGET_2_HIT"
              ? "🚀 Target 2 reached! Full profit booked."
              : status.reason === "MARKET_CLOSE_SQUAREOFF"
                ? "⏰ 03:15 PM Auto-Square-off executed."
                : status.reason === "TRAILING_SL_HIT"
                  ? "🛡️ Trailing SL hit! Cost protected."
                  : status.reason === "VWAP_BREACH_EXIT"
                    ? "⚠️ VWAP buffer breached. Risk cut."
                    : status.reason === "TIME_DECAY_TIMEOUT"
                      ? "⌛ 25-minute time limit reached. Position closed."
                      : "🛑 Position closed: " + status.reason,
        });

        // Quarantine is a live-trading safety. Practice trades never touch it.
        if (!isProfit && !isReplay) {
          setStockPostLossCooldown(stockToken, 45);
        }

        signalMemoryRef.current[memKey] = recordExit(
          signalMemoryRef.current[memKey],
          nowMs,
        );

        const updated = { ...activeTradesRef.current };
        delete updated[stockToken];
        syncTrades(updated);
        return;
      }

      return;
    }

    // --- B. NEW SETUP EVALUATION ---
    // LIVE: only with an open market and a fresh feed. (Without this the app
    // used to fire signals from Friday's candles on a Sunday night.)
    if (!isReplay && !signalGate.allowed) return;

    if (!isReplay) {
      const quarantine = isStockInCooldown(stockToken);
      if (quarantine.inCooldown) return;

      const throttle = checkStockSignalThrottle(stockToken, 5);
      if (!throttle.allowed) return;
    }

    // Signals are judged on the newest fully CLOSED candle only
    const completedCandle = signalData[signalData.length - 1];
    if (!completedCandle) return;

    // One evaluation per stock per closed candle
    const candleKey = `${stockToken}:${completedCandle.time}`;
    if (candleKey === lastProcessedCandleKey.current) return;
    lastProcessedCandleKey.current = candleKey;

    async function executeSignalCheck() {
      if (Math.abs(signalScore) < 65) {
        setSignalNote(null);
        return;
      }

      const allowedNow = checkSignalAllowed(
        signalMemoryRef.current[memKey],
        nowMs,
      );
      if (!allowedNow.allowed) {
        setSignalNote(allowedNow.reason);
        return;
      }
      setSignalNote(null);

      const setup = await evaluateTradeSetup(
        signalScore,
        niftyBias,
        completedCandle,
        signalBasis.ind?.latest?.vwap ?? vwap,
        signalAtr,
        {
          nowMs,
          // Trade window now applies (edit TRADE_WINDOW in lib/sessionUtils.js)
          bypassTimeWindow: false,
          useGroqValidation: false,
          symbol: currentStock.symbol,
          timeframe: selectedTF,
          regime: marketRegime,
        },
      );

      if (setup && (setup.action === "BUY" || setup.action === "SELL")) {
        if (!isReplay) markStockSignalExecuted(stockToken);
        signalMemoryRef.current[memKey] = recordEntry(
          signalMemoryRef.current[memKey],
          setup.action,
        );

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
          startTime: nowMs,
          maxTime: setup.maxTime,
          logId: `${nowMs}-${stockToken}`,
        };

        setTradeLog((prev) => [
          ...prev,
          {
            id: newTradeRecord.logId,
            symbol: currentStock.symbol,
            side: setup.action,
            entry: setup.entry,
            entryClock: hhmmStr(nowMs),
            dateStr: dayKey,
            isReplay,
            timeframe: selectedTF,
            token: String(stockToken),
            // Feature snapshot for future ML training (shadow only; never changes the call)
            feat: {
              score: Number(signalScore?.score ?? signalScore) || 0,
              atrPct: signalAtr && setup.entry ? +((signalAtr / setup.entry) * 100).toFixed(3) : 0,
              vwapDist: signalAtr ? +(((setup.entry - (signalBasis.ind?.latest?.vwap ?? vwap)) / signalAtr)).toFixed(3) : 0,
              vol: Number(completedCandle?.volume) || 0,
              regime: typeof marketRegime === "string" ? marketRegime : (marketRegime?.label || marketRegime?.regime || ""),
              niftyBias: typeof niftyBias === "string" ? niftyBias : (niftyBias?.bias || niftyBias?.label || ""),
              mins: (Math.floor(nowMs / 60000) + 330) % 1440, // minutes since midnight IST
              newsSent: newsRef.current.symbol === currentStock.symbol && newsRef.current.tag ? newsRef.current.tag.sentiment : 0,
              eventRisk: newsRef.current.symbol === currentStock.symbol && newsRef.current.tag ? newsRef.current.tag.eventRisk : "nodata",
              newsCred: newsRef.current.symbol === currentStock.symbol && newsRef.current.tag && newsRef.current.tag.credibility != null ? newsRef.current.tag.credibility : -1,
              newsScope: newsRef.current.symbol === currentStock.symbol && newsRef.current.tag ? newsRef.current.tag.impactScope || "none" : "nodata",
            },
            stopLoss: setup.stopLoss,
            initialSl: setup.initialSl ?? setup.stopLoss,
            target1: setup.target1,
            target2: setup.target2,
            exitPrice: null,
          },
        ]);

        // 🔒 Freeze levels in state so they never change on subsequent ticks
        setLockedSignalLevels((prev) => ({
          ...prev,
          [stockToken]: {
            entry: setup.entry,
            stopLoss: setup.stopLoss,
            target1: setup.target1,
            target2: setup.target2,
            rrRatio: formatRiskReward(setup.entry, setup.stopLoss, setup.target1),
          },
        }));

        const updated = { ...activeTradesRef.current };
        updated[stockToken] = newTradeRecord;
        syncTrades(updated);

        setActiveAlert({
          type: setup.action,
          symbol: currentStock.symbol,
          token: String(currentStock.token),
          exchangeSegment: currentStock.exchangeSegment || 1,
          price: setup.entry,
          score: signalScore,
          pattern: signalBasis.pattern?.name || "PRICE_ACTION",
          vwap,
          rsi: signalBasis.ind?.latest?.rsi ?? ind.latest.rsi,
          isReplay,
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
    ind,
    data,
    signalData,
    signalScore,
    signalAtr,
    signalBasis,
    signalGate,
    mode,
    virtualNowMs,
    currentStock,
    isExecutionTimeframe,
    niftyBias,
    marketRegime,
    selectedTF,
  ]);

  const stockTokenStr = String(currentStock.token);
  const activeTradeInstance = activeTradesState[stockTokenStr];
  const stockQuarantineStatus = mounted
    ? isStockInCooldown(stockTokenStr)
    : { inCooldown: false };

  const isSetupActive =
    !killSwitchActive &&
    ((signalGate.allowed && Math.abs(finalCompositeScore) >= 65) ||
      !!activeTradeInstance);

  // 🔒 Closed-candle anchored trade levels (Insulated against live tick recalculations)
  const frozenTradeLevels = useMemo(() => {
    if (activeTradeInstance) {
      return {
        entry: activeTradeInstance.entry,
        stopLoss: activeTradeInstance.stopLoss,
        target1: activeTradeInstance.target1,
        target2: activeTradeInstance.target2,
        rrRatio: formatRiskReward(
          activeTradeInstance.entry,
          activeTradeInstance.initialSl ?? activeTradeInstance.stopLoss,
          activeTradeInstance.target1,
        ),
      };
    }

    if (lockedSignalLevels[stockTokenStr]) {
      return lockedSignalLevels[stockTokenStr];
    }

    const closedCandle =
      signalData && signalData.length >= 1
        ? signalData[signalData.length - 1]
        : null;
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
    signalData && signalData.length >= 1
      ? signalData[signalData.length - 1]?.time
      : null,
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

  // ---- Derived values for the chart workspace ---------------------------
  const isIndexStock =
    String(currentStock.token).startsWith("99926") ||
    currentStock.exchangeSegment === 13;
  const stockInWatchlist = isInWatchlist(currentStock.token);
  const visibleLog = tradeLog.filter((t) => t.isReplay === (mode === "REPLAY"));

  const chartHeight = bigChart
    ? Math.max(360, vp.h - 150)
    : vp.w >= 1024
      ? Math.max(500, Math.min(680, vp.h - 200))
      : Math.max(380, Math.min(520, Math.round(vp.h * 0.55)));

  const chartLevels = activeTradeInstance
    ? {
        entry: activeTradeInstance.entry,
        stopLoss: activeTradeInstance.stopLoss,
        target1: activeTradeInstance.target1,
        target2: activeTradeInstance.target2,
        side: activeTradeInstance.side || activeTradeInstance.action,
      }
    : null;

  // Plain-words answer to "why is there no call right now?"
  const windowReason = signalGate.windowReason || signalGate.reason;
  let waitReason;
  if (killSwitchActive) waitReason = "The kill switch is ON, so no calls are given.";
  else if (stockQuarantineStatus.inCooldown)
    waitReason = `Post-loss lockout: ${stockQuarantineStatus.remainingMins} min left.`;
  else if (mode === "LIVE" && !signalGate.allowed) waitReason = signalGate.reason;
  else if (!isExecutionTimeframe) waitReason = "Calls are only given on the 5-minute chart.";
  else if (Math.abs(signalScore) >= 65)
    waitReason =
      signalNote ||
      (!signalGate.inWindow
        ? `Score ${signalScore} is strong, but ${windowReason}.`
        : "Setup is strong; waiting for the next closed candle to confirm.");
  else
    waitReason = `Score ${signalScore} is inside ±65, so there is no clear edge.${
      signalGate.inWindow ? "" : ` (${windowReason})`
    }`;

  const addCurrentToWatchlist = () =>
    addToWatchlist({
      symbol: currentStock.symbol,
      token: String(currentStock.token),
      exchangeSegment: currentStock.exchangeSegment || 1,
    });

  const addCallToWatchlist = (t) =>
    addToWatchlist({
      symbol: currentStock.symbol,
      token: String(currentStock.token),
      exchangeSegment: currentStock.exchangeSegment || 1,
      side: t.side || t.action,
      entry: t.entry,
      stopLoss: t.initialSl ?? t.stopLoss,
      target1: t.target1,
      target2: t.target2,
      score: signalScore,
      note: mode === "REPLAY" ? "From REPLAY (practice)" : "",
    });

  const tabBtn = (id, label) => (
    <button
      key={id}
      onClick={() => setPanelTab(id)}
      style={{
        flex: 1,
        padding: "6px 4px",
        fontSize: "0.7rem",
        fontWeight: 800,
        cursor: "pointer",
        background: panelTab === id ? "#1e3a8a55" : "transparent",
        color: panelTab === id ? "#93c5fd" : "#64748b",
        border: "none",
        borderBottom: `2px solid ${panelTab === id ? "#3b82f6" : "transparent"}`,
      }}
    >
      {label}
    </button>
  );

  const chartCard = (
    <section
      className="card chart-card"
      style={
        bigChart
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 9000,
              borderRadius: 0,
              overflow: "auto",
              background: "#0b101b",
              padding: 12,
            }
          : { minWidth: 0 }
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <h2 className="card-title" style={{ margin: 0 }}>
          {currentStock.symbol} · {selectedTF}M
        </h2>
        <span
          style={{
            fontFamily: "monospace",
            fontWeight: 800,
            color: "#f8fafc",
          }}
        >
          ₹{fmt(ind?.latest?.price)}
        </span>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 800,
            padding: "2px 8px",
            borderRadius: 4,
            color: activeTradeInstance
              ? (activeTradeInstance.side || activeTradeInstance.action) === "BUY"
                ? "#2FD98A"
                : "#FF5D5D"
              : "#94a3b8",
            border: "1px solid #334155",
          }}
        >
          {activeTradeInstance
            ? `${activeTradeInstance.side || activeTradeInstance.action} CALL OPEN`
            : "NO CALL"}
        </span>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 800,
            padding: "2px 8px",
            borderRadius: 4,
            color: patternBadgeColor,
            border: `1px solid ${patternBadgeColor}55`,
          }}
        >
          {(candlePattern?.name || "NONE").toUpperCase()}
        </span>

        {mode === "REPLAY" && replaySession && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <button onClick={restartReplay} style={replayBtnStyle}>
              ⏮
            </button>
            <button
              onClick={() => setReplayPlaying((p) => !p)}
              style={replayBtnStyle}
            >
              {replayPlaying ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => {
                setReplayPlaying(false);
                setReplayCount((c) => Math.min(c + 1, replaySession.length));
              }}
              style={replayBtnStyle}
            >
              ⏭
            </button>
            <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "#fbbf24" }}>
              {data[data.length - 1]?.clock || "--:--"}
            </span>
          </span>
        )}

        <button
          onClick={() => setBigChart((b) => !b)}
          style={{ ...replayBtnStyle, marginLeft: "auto", color: "#93c5fd", borderColor: "#3b82f6" }}
          title="Full screen chart (Esc to close)"
        >
          {bigChart ? "✕ Close big chart" : "⛶ Big chart"}
        </button>
      </div>

      <div className="legend" style={{ marginBottom: 8 }}>
        <span className="leg-item"><span className="dot dot-e9" /> EMA 9</span>
        <span className="leg-item"><span className="dot dot-e21" /> EMA 21</span>
        <span className="leg-item"><span className="dot dot-vwap" /> VWAP</span>
        <span className="leg-item"><span className="box box-cpr" /> CPR Band</span>
        <span className="leg-item"><span className="box box-orb" /> ORB</span>
      </div>

      <PriceChart
        data={data}
        ind={ind}
        score={signalScore}
        height={chartHeight}
        visibleBars={bigChart ? 150 : 90}
        levels={chartLevels}
      />
    </section>
  );

  const sidePanel = (
    <aside className="card side-panel" style={{ padding: 0, minWidth: 0 }}>
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b" }}>
        {tabBtn("CALL", "CALL")}
        {tabBtn("LOG", `LOG${visibleLog.length ? ` (${visibleLog.length})` : ""}`)}
        {tabBtn("WATCH", `WATCHLIST${watchlist.length ? ` (${watchlist.length})` : ""}`)}
        {tabBtn("FUNDA", "FUNDAMENTALS")}
      </div>
      <div style={{ padding: 12 }}>
        {panelTab === "CALL" && (
          <CurrentCallCard
            symbol={currentStock.symbol}
            ltp={ind?.latest?.price}
            score={signalScore}
            trade={activeTradeInstance || null}
            waitReason={waitReason}
            isReplay={mode === "REPLAY"}
            inWatchlist={
              activeTradeInstance
                ? isCallSaved(currentStock.token, activeTradeInstance.entry)
                : stockInWatchlist
            }
            onAddWatchlist={() =>
              activeTradeInstance && addCallToWatchlist(activeTradeInstance)
            }
          />
        )}
        {panelTab === "LOG" && (
          <TradeLog log={visibleLog} isReplay={mode === "REPLAY"} />
        )}
        {panelTab === "WATCH" && (
          <WatchlistPanel
            items={watchlist}
            loading={wlLoading}
            error={wlError}
            activeToken={String(currentStock.token)}
            canAddCurrent={!stockInWatchlist}
            currentSymbol={currentStock.symbol}
            onAddCurrent={addCurrentToWatchlist}
            onSelect={(w) =>
              handleStockChange({
                symbol: w.symbol,
                token: w.token,
                exchangeSegment: w.exchangeSegment || 1,
              })
            }
            onRemove={(w) => removeFromWatchlist(w.token)}
          />
        )}
        {panelTab === "FUNDA" && (
          <FundamentalsPanel symbol={currentStock.symbol} isIndex={isIndexStock} />
        )}
      </div>
    </aside>
  );

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
              border: `1px solid ${
                !niftyData
                  ? "#33415540"
                  : niftyData.change >= 0
                    ? "#2FD98A40"
                    : "#FF5D5D40"
              }`,
              fontSize: "0.74rem",
              fontWeight: 600,
            }}
          >
            <span style={{ color: "#94a3b8" }}>NIFTY 50</span>
            {niftyData ? (
              <>
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
              </>
            ) : (
              <span style={{ color: "#64748b", fontFamily: "monospace" }}>
                —
              </span>
            )}
          </div>

          <span
            style={{
              fontSize: "0.72rem",
              padding: "3px 8px",
              borderRadius: 4,
              background: `${feedBadge.color}22`,
              color: feedBadge.color,
              border: `1px solid ${feedBadge.color}`,
              fontWeight: 700,
            }}
          >
            {feedBadge.text}
          </span>

          <div style={{ display: "inline-flex", gap: 0 }}>
            {["LIVE", "REPLAY"].map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  fontSize: "0.72rem",
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontWeight: 700,
                  border: "1px solid #334155",
                  borderRadius:
                    m === "LIVE" ? "4px 0 0 4px" : "0 4px 4px 0",
                  background:
                    mode === m
                      ? m === "REPLAY"
                        ? "#fbbf24"
                        : "#2FD98A"
                      : "#0f172a",
                  color: mode === m ? "#0b101b" : "#94a3b8",
                }}
              >
                {m}
              </button>
            ))}
          </div>

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

          <Link
            href="/dashboard"
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
            📊 100-TRADE GATE
          </Link>

          <Link
            href="/research"
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
            🤖 BOTS
          </Link>

          <Link
            href="/autopsy"
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
            🔬 AUTOPSY
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

          <button
            onClick={() =>
              stockInWatchlist
                ? removeFromWatchlist(String(currentStock.token))
                : addCurrentToWatchlist()
            }
            title={stockInWatchlist ? "Remove from watchlist" : "Add to watchlist"}
            style={{
              fontSize: "0.74rem",
              padding: "4px 10px",
              borderRadius: 4,
              fontWeight: 800,
              cursor: "pointer",
              background: stockInWatchlist ? "rgba(251,191,36,0.15)" : "transparent",
              color: "#fbbf24",
              border: "1px solid #fbbf24",
            }}
          >
            {stockInWatchlist ? "★ Watching" : "☆ Watchlist"}
          </button>
        </div>
      </header>

      {/* LIVE: why signals are paused (market closed / stale feed) */}
      {mode === "LIVE" && !signalGate.allowed && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 14px",
            background: "rgba(148, 163, 184, 0.1)",
            border: "1px solid #475569",
            borderRadius: 6,
            color: "#cbd5e1",
            fontSize: "0.78rem",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span>⏸ {signalGate.reason}</span>
          <button
            onClick={() => switchMode("REPLAY")}
            style={{
              fontSize: "0.72rem",
              padding: "3px 10px",
              borderRadius: 4,
              background: "#fbbf24",
              color: "#0b101b",
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ▶ Open REPLAY
          </button>
        </div>
      )}

      {/* LIVE: market open but outside the entry window */}
      {mode === "LIVE" && signalGate.allowed && !signalGate.inWindow && (
        <div
          style={{
            margin: "8px 0",
            padding: "6px 14px",
            background: "rgba(251, 191, 36, 0.08)",
            border: "1px solid #92400e",
            borderRadius: 6,
            color: "#fbbf24",
            fontSize: "0.74rem",
            fontWeight: 600,
          }}
        >
          🕒 No new entries now: {signalGate.windowReason}. Open trades are
          still managed.
        </div>
      )}

      {/* REPLAY control bar */}
      {mode === "REPLAY" && (
        <div
          style={{
            margin: "8px 0",
            padding: "10px 14px",
            background: "rgba(251, 191, 36, 0.08)",
            border: "1px solid #fbbf24",
            borderRadius: 6,
            color: "#fbbf24",
            fontSize: "0.78rem",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <strong>▶ REPLAY MODE</strong>
          {replaySession ? (
            <>
              <span style={{ color: "#e2e8f0" }}>
                Real candles from {replaySession.date}, played one by one.
                Practice only - nothing is saved to live trades or accuracy.
              </span>
              <button onClick={restartReplay} style={replayBtnStyle}>
                ⏮ Restart
              </button>
              <button
                onClick={() => setReplayPlaying((p) => !p)}
                style={replayBtnStyle}
              >
                {replayPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
              <button
                onClick={() => {
                  setReplayPlaying(false);
                  setReplayCount((c) => Math.min(c + 1, replaySession.length));
                }}
                style={replayBtnStyle}
              >
                ⏭ Next candle
              </button>
              <select
                value={replayDelayMs}
                onChange={(e) => setReplayDelayMs(Number(e.target.value))}
                style={{ ...replayBtnStyle, padding: "3px 6px" }}
              >
                <option value={1500}>Slow</option>
                <option value={700}>Normal</option>
                <option value={250}>Fast</option>
                <option value={80}>Very fast</option>
              </select>
              <input
                type="range"
                min={1}
                max={replaySession.length}
                value={Math.min(replayCount, replaySession.length)}
                onChange={(e) => {
                  setReplayPlaying(false);
                  setReplayCount(Number(e.target.value));
                }}
                style={{ flex: "1 1 160px" }}
              />
              <span style={{ fontFamily: "monospace", color: "#e2e8f0" }}>
                {Math.min(replayCount, replaySession.length)}/
                {replaySession.length} ·{" "}
                {data[data.length - 1]?.clock || "--:--"} IST
              </span>
            </>
          ) : (
            <span style={{ color: "#e2e8f0" }}>
              Waiting for a completed past session from Angel One... (needs at
              least one finished trading day in the fetched candles)
            </span>
          )}
        </div>
      )}

      {/* Why no new call although the score is high */}
      {signalNote && (
        <div
          style={{
            margin: "8px 0",
            padding: "6px 14px",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px solid #0c4a6e",
            borderRadius: 6,
            color: "#7dd3fc",
            fontSize: "0.74rem",
            fontWeight: 600,
          }}
        >
          ℹ️ {currentStock.symbol}: no new call - {signalNote}
        </div>
      )}

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

      {/* Big chart + side panel (call / log / watchlist / fundamentals) */}
      <div className="workspace">
        {chartCard}
        {sidePanel}
      </div>

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
          {Gauge ? (
            <Gauge score={finalCompositeScore} modeLabel={mode === "REPLAY" ? "REPLAY" : "LIVE"} />
          ) : null}

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

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
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
        activeAlert={mode === "REPLAY" ? null : activeAlert}
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

      {SignalAlertModal && (
        <SignalAlertModal
          alert={activeAlert}
          onClose={() => setActiveAlert(null)}
          inWatchlist={activeAlert?.levels ? isCallSaved(activeAlert.token, activeAlert.levels.entry) : false}
          onAddWatchlist={() => {
            const a = activeAlert;
            if (!a?.levels) return;
            addToWatchlist({
              symbol: a.symbol,
              token: a.token,
              exchangeSegment: a.exchangeSegment || 1,
              side: a.type,
              entry: a.levels.entry,
              stopLoss: a.levels.stopLoss,
              target1: a.levels.target1,
              target2: a.levels.target2,
              score: a.score,
              note: a.isReplay ? "From REPLAY (practice)" : "",
            });
          }}
        />
      )}
    </main>
  );
}
