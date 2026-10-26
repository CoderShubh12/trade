// lib/indiaGap.js - PAPER-ONLY NSE vs BSE price-gap scanner for the stock pool (Angel quote API, no orders).
// For each stock present on both exchanges: buy at the lower ask, sell at the higher bid. Gross gap % is compared with estimated round-trip costs
// (brokerage both legs, STT, exchange fees, GST, stamp, ~0.06% at this size) and a slippage allowance. It MEASURES whether any gap survives costs,
// it does not trade. Quotes are polled (not streamed), so a gap seen here may already be gone when an order would reach the exchange.
import axios from "axios";
import { STOCK_POOL } from "@/lib/stockPool";
import { getAngelSession } from "@/lib/angelAuth";
import { roundTripCost } from "@/lib/costs";

const g = globalThis;
g.__igap = g.__igap || { timer: null, busy: false, map: null, mapErr: "", since: Date.now(), stats: {}, last: {}, dbg: {}, ver: 0, err: "", polls: 0, events: [] };
const POLL_MS = 5000, SLIP = 0.0002; // 0.02% allowance for slippage/latency
const MASTER = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

async function buildMap() {
  const G = g.__igap;
  try {
    const rows = (await axios.get(MASTER, { timeout: 90000, maxContentLength: 1e9 })).data;
    const want = new Map(STOCK_POOL.filter((x) => x.baseBand !== "INDEX").map((x) => [x.symbol, String(x.token)]));
    const bse = new Map();
    for (const r of rows) { if (r.exch_seg === "BSE" && !r.instrumenttype && want.has(String(r.symbol).replace(/-EQ$/, ""))) bse.set(String(r.symbol).replace(/-EQ$/, ""), String(r.token)); }
    G.map = [...want].filter(([s]) => bse.has(s)).map(([symbol, nse]) => ({ symbol, nse, bse: bse.get(symbol) }));
    G.mapErr = G.map.length ? "" : "no BSE tokens matched";
  } catch (e) { G.mapErr = String(e.message || e).slice(0, 80); }
}
const best = (d) => ({ bid: Number(d?.depth?.buy?.[0]?.price) || 0, bidQty: Number(d?.depth?.buy?.[0]?.quantity) || 0, ask: Number(d?.depth?.sell?.[0]?.price) || 0, askQty: Number(d?.depth?.sell?.[0]?.quantity) || 0, ltp: Number(d?.ltp) || 0 });

async function tick() {
  const G = g.__igap; if (G.busy) return; G.busy = true;
  try {
    if (!G.map) { await buildMap(); if (!G.map) return; }
    const s = await getAngelSession(), nse = G.map.map((x) => x.nse), bse = G.map.map((x) => x.bse);
    const res = await axios.post("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/", { mode: "FULL", exchangeTokens: { NSE: nse.slice(0, 50), BSE: bse.slice(0, 50) } },
      { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": s.apiKey }, timeout: 8000 });
    const f = res.data?.data?.fetched || [], un = res.data?.data?.unfetched || [];
    G.dbg = { fetchedNSE: f.filter((x) => x.exchange === "NSE").length, fetchedBSE: f.filter((x) => x.exchange === "BSE").length, unfetched: un.length, bseWithDepth: f.filter((x) => x.exchange === "BSE" && Number(x.depth?.buy?.[0]?.price) > 0).length, nseWithDepth: f.filter((x) => x.exchange === "NSE" && Number(x.depth?.buy?.[0]?.price) > 0).length, sampleBSE: f.find((x) => x.exchange === "BSE") ? { tradingSymbol: f.find((x) => x.exchange === "BSE").tradingSymbol, ltp: f.find((x) => x.exchange === "BSE").ltp, depth: f.find((x) => x.exchange === "BSE").depth } : null, sampleUnfetched: un.slice(0, 3), msg: res.data?.message };
    byTok = new Map(f.map((x) => [`${x.exchange}:${x.symbolToken}`, best(x)]));
    G.polls++; G.err = "";
    for (const m of G.map) {
      const a = byTok.get(`NSE:${m.nse}`), b = byTok.get(`BSE:${m.bse}`);
      if (!a || !b || !(a.bid > 0 && a.ask > 0 && b.bid > 0 && b.ask > 0)) continue;
      const opt = [{ buy: "NSE", sell: "BSE", buyAsk: a.ask, sellBid: b.bid, qty: Math.min(a.askQty, b.bidQty) }, { buy: "BSE", sell: "NSE", buyAsk: b.ask, sellBid: a.bid, qty: Math.min(b.askQty, a.bidQty) }];
      const o = opt.reduce((x, y) => ((y.sellBid - y.buyAsk) / y.buyAsk > (x.sellBid - x.buyAsk) / x.buyAsk ? y : x));
      const gross = (o.sellBid - o.buyAsk) / o.buyAsk, qty = Math.max(1, Math.min(o.qty, Math.floor(50000 / o.buyAsk))), cost = roundTripCost(o.buyAsk, qty) / (o.buyAsk * qty), net = gross - cost - SLIP;
      const S = (G.stats[m.symbol] = G.stats[m.symbol] || { ticks: 0, sumGross: 0, maxGross: -1, maxNet: -1, pos: 0 });
      S.ticks++; S.sumGross += gross; S.maxGross = Math.max(S.maxGross, gross); S.maxNet = Math.max(S.maxNet, net);
      G.last[m.symbol] = { buy: o.buy, sell: o.sell, buyAsk: o.buyAsk, sellBid: o.sellBid, gross, net, qty: o.qty };
      if (net > 0) { S.pos++; G.events.push({ t: Date.now(), symbol: m.symbol, buy: o.buy, sell: o.sell, buyAsk: o.buyAsk, sellBid: o.sellBid, grossPct: +(gross * 100).toFixed(3), netPct: +(net * 100).toFixed(3), qtyAtBest: o.qty }); if (G.events.length > 200) G.events.shift(); }
    }
  } catch (e) { g.__igap.err = String(e.response?.data?.message || e.message).slice(0, 80); }
  finally { g.__igap.busy = false; }
}
const VER = 2;
export function ensureIndiaGap() { if (g.__igap.timer && g.__igap.ver !== VER) { clearInterval(g.__igap.timer); g.__igap.timer = null; g.__igap.map = null; } if (!g.__igap.timer) { g.__igap.ver = VER; g.__igap.timer = setInterval(tick, POLL_MS); setTimeout(tick, 500); } }
export function indiaGapStatus() {
  const G = g.__igap, rows = Object.entries(G.stats).map(([symbol, s]) => ({ symbol, ticks: s.ticks, avgGrossPct: +(s.sumGross / s.ticks * 100).toFixed(3), maxGrossPct: +(s.maxGross * 100).toFixed(3), maxNetPct: +(s.maxNet * 100).toFixed(3), ticksNetPositive: s.pos, now: G.last[symbol] ? { buy: G.last[symbol].buy, sell: G.last[symbol].sell, grossPct: +(G.last[symbol].gross * 100).toFixed(3), netPct: +(G.last[symbol].net * 100).toFixed(3), qtyAtBest: G.last[symbol].qty } : null })).sort((a, b) => b.maxNetPct - a.maxNetPct);
  return { running: !!G.timer, minutes: +((Date.now() - G.since) / 60000).toFixed(1), polls: G.polls, pairsMatched: G.map ? G.map.length : 0, mapError: G.mapErr, error: G.err, debug: G.dbg, rows: rows.slice(0, 50), recentNetPositive: G.events.slice(-10).reverse(), note: "Paper measurement only. Net = gross - estimated costs - 0.02% slippage; polled quotes, no latency/partial-fill model. NSE and BSE positions are separate intraday positions (MIS) so both legs need margin." };
}
