// lib/angelNifty.js - Nifty 50 5m candles straight from Angel One getCandleData (one call, cached 30 s, backs off on rate limit).
// Used only by the Nifty reversal chart. Callers fall back to Yahoo when this throws.
import axios from "axios";
import { getAngelSession } from "@/lib/angelAuth";

const g = globalThis;
g.__angelNifty = g.__angelNifty || { at: 0, bars: null, pauseUntil: 0, fails: 0 };
const IST = 5.5 * 3600 * 1000, pad = (n) => String(n).padStart(2, "0");
const ist = (d) => { const x = new Date(d.getTime() + IST); return { day: `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`, h: x.getUTCHours(), m: x.getUTCMinutes() }; };

export async function getAngelNifty5m() {
  const S = g.__angelNifty;
  if (S.bars && Date.now() - S.at < 30000) return S.bars;
  if (Date.now() < S.pauseUntil) throw new Error("Angel candle calls paused (rate limit)");
  const session = await getAngelSession();
  if (!session?.jwtToken) throw new Error("Angel session failed");
  const now = new Date(), from = ist(new Date(now.getTime() - 3 * 86400000)), to = ist(now);
  try {
    const res = await axios.post("https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
      { exchange: "NSE", symboltoken: "99926000", interval: "FIVE_MINUTE", fromdate: `${from.day} 09:15`, todate: `${to.day} ${pad(to.h)}:${pad(to.m)}` },
      { timeout: 8000, headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session.jwtToken}`, "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "fe80::1", "X-PrivateKey": session.apiKey } });
    const raw = res.data?.data;
    if (!(res.data?.status && Array.isArray(raw) && raw.length)) throw new Error(res.data?.message || "Angel returned no Nifty candles");
    const bars = raw.map((b) => { const ts = String(b[0]); return { time: Math.floor(new Date(ts).getTime() / 1000), date: ts.slice(0, 10), clock: ts.slice(11, 16), open: +b[1], high: +b[2], low: +b[3], close: +b[4], volume: Number(b[5]) || 1 }; })
      .filter((b) => b.clock >= "09:15" && b.clock <= "15:29");
    if (bars.length < 5) throw new Error("Angel returned too few Nifty candles");
    S.bars = bars; S.at = Date.now(); S.fails = 0;
    return bars;
  } catch (e) {
    const code = e.response?.status;
    if (code === 403 || code === 429) { S.fails++; S.pauseUntil = Date.now() + [30000, 60000, 120000, 300000][Math.min(3, S.fails - 1)]; }
    throw e;
  }
}
