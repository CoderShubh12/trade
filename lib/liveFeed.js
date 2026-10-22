// lib/liveFeed.js  (server only)
// Real-time prices from Angel One's REST quote call (mode LTP): about 1 request per second for
// ALL wanted tokens together, shared by every caller. (The WebSocket stream returned nothing
// on this account, the REST quote works and is real-time.) Credentials stay on the server.
import axios from "axios";
import { getAngelSession } from "./angelAuth.js";
import { recordTick } from "./tickCandles.js";

const QUOTE_URL = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/";
const MIN_GAP_MS = 900;
const WANT_FOR_MS = 60000; // stop fetching a token 60 s after the page stopped asking
const MAX_TOKENS = 40;

const g = globalThis;
const Q = (g.__liveQuote = g.__liveQuote || { ticks: new Map(), wanted: new Map(), lastAt: 0, inflight: null, error: "", backoffUntil: 0 });

async function fetchQuotes() {
  const now = Date.now();
  for (const [t, at] of Q.wanted) if (now - at > WANT_FOR_MS) Q.wanted.delete(t);
  const tokens = [...Q.wanted.keys()].slice(0, MAX_TOKENS);
  if (!tokens.length) return;
  try {
    const s = await getAngelSession();
    const res = await axios.post(
      QUOTE_URL,
      { mode: "FULL", exchangeTokens: { NSE: tokens.slice(0, 50) } },
      {
        headers: {
          "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${s.jwtToken}`,
          "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "fe80::1", "X-PrivateKey": s.apiKey,
        },
        timeout: 4000,
      },
    );
    const rows = res.data?.data?.fetched;
    if (!res.data?.status || !Array.isArray(rows)) throw new Error(res.data?.message || "Quote failed");
    const at = Date.now();
    for (const r of rows) if (Number(r.ltp) > 0) { Q.ticks.set(String(r.symbolToken), { ltp: Number(r.ltp), ts: at }); recordTick(r.symbolToken, Number(r.ltp), Number(r.tradeVolume), at); }
    Q.error = "";
  } catch (e) {
    Q.error = e.response?.status ? `HTTP ${e.response.status}` : e.message;
    Q.backoffUntil = Date.now() + 2000;
  } finally {
    Q.lastAt = Date.now();
  }
}

// Ask for these tokens; returns the newest prices (fetches at most once per MIN_GAP_MS overall).
export async function getTicks(tokens) {
  const now = Date.now();
  for (const t of tokens) if (Q.wanted.size < MAX_TOKENS || Q.wanted.has(t)) Q.wanted.set(t, now);

  // A token never seen, or seen long ago (e.g. you switched back to a stock), must be refreshed BEFORE answering.
  const missing = tokens.some((t) => !Q.ticks.has(t) || now - Q.ticks.get(t).ts > 5000);
  const due = now - Q.lastAt > MIN_GAP_MS && now >= Q.backoffUntil;
  if (!Q.inflight && (due || (missing && now >= Q.backoffUntil && now - Q.lastAt > 300))) {
    Q.inflight = fetchQuotes().finally(() => { Q.inflight = null; });
  }
  if (Q.inflight) await Q.inflight;
  // An earlier in-flight request may have started before these tokens were wanted: refresh once more.
  if (!Q.inflight && Date.now() >= Q.backoffUntil && tokens.some((t) => !Q.ticks.has(t) || Date.now() - Q.ticks.get(t).ts > 5000)) {
    Q.inflight = fetchQuotes().finally(() => { Q.inflight = null; });
    await Q.inflight;
  }

  const t2 = Date.now();
  const ticks = {};
  for (const t of tokens) {
    const x = Q.ticks.get(t);
    if (x) ticks[t] = { ltp: x.ltp, ageMs: t2 - x.ts };
  }
  return { ticks, connected: !Q.error, error: Q.error || null, source: "ANGEL_REST_QUOTE" };
}
