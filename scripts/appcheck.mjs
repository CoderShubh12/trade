// scripts/appcheck.mjs  -  run on YOUR computer while `npm run dev` is running:
//   node --env-file=.env.local scripts/appcheck.mjs
// Logs in with APP_LOGIN_USER / APP_LOGIN_PASSWORD from .env.local (the password is never printed or saved),
// then calls every main page and API and prints a short PASS/WARN/FAIL report. Also saves data/appcheck.json (no secrets).
// Read-only: it places no trades and changes nothing.
import fs from "node:fs";
const BASE = process.env.APP_BASE || "http://localhost:3000";
const u = process.env.APP_LOGIN_USER, p = process.env.APP_LOGIN_PASSWORD;
if (!u || !p) { console.log("FAIL  APP_LOGIN_USER / APP_LOGIN_PASSWORD missing in .env.local"); process.exit(1); }
const out = [];
const add = (name, level, note) => { out.push({ name, level, note }); console.log(`${level.padEnd(4)}  ${name.padEnd(26)} ${note}`); };
const ist = new Date(Date.now() + 330 * 60000), hm = ist.getUTCHours() * 100 + ist.getUTCMinutes(), dow = ist.getUTCDay();
console.log(`IST ${ist.toISOString().slice(0, 16).replace("T", " ")}  market ${dow >= 1 && dow <= 5 && hm >= 915 && hm <= 1530 ? "OPEN" : "CLOSED (09:15-15:30 Mon-Fri)"}\n`);
let cookie = "";
try {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, user: u, password: p }), redirect: "manual" });
  const sc = r.headers.getSetCookie?.() || [];
  cookie = sc.map((c) => c.split(";")[0]).join("; ");
  add("login", r.ok && cookie ? "PASS" : "FAIL", `HTTP ${r.status}${cookie ? "" : " (no session cookie)"}`);
} catch (e) { add("server", "FAIL", `cannot reach ${BASE}: ${e.message} (is npm run dev running?)`); process.exit(1); }
const get = async (path) => {
  const t = Date.now();
  try { const r = await fetch(BASE + path, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(25000) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {} return { s: r.status, j, txt, ms: Date.now() - t }; }
  catch (e) { return { s: 0, err: e.message, ms: Date.now() - t }; }
};
for (const pg of ["/", "/dashboard", "/research", "/tips", "/autopsy"]) { const r = await get(pg); add(`page ${pg}`, r.s === 200 ? "PASS" : "FAIL", `HTTP ${r.s} ${r.ms}ms`); }
const api = [
  ["/api/health", (j) => `ok=${j.ok ?? j.success} ${JSON.stringify(j).slice(0, 160)}`],
  ["/api/engine", (j) => JSON.stringify(j).slice(0, 200)],
  ["/api/ltp?tokens=99926000,99926009,3045", (j) => JSON.stringify(j).slice(0, 200)],
  ["/api/market-data?token=3045&tf=5", (j) => `candles=${j.data?.length ?? 0} last=${j.data?.at(-1)?.date || ""} ${j.data?.at(-1)?.clock || ""}`],
  ["/api/market-data?token=99926000&tf=5", (j) => `candles=${j.data?.length ?? 0} last=${j.data?.at(-1)?.date || ""} ${j.data?.at(-1)?.clock || ""}`],
  ["/api/watchlist", (j) => `items=${j.items?.length}`],
  ["/api/journal", (j) => `trades=${(j.trades || j.items || j.data || []).length}`],
  ["/api/autopsy?limit=5&live=0", (j) => `trades=${j.trades?.length} skipped=${j.skipped?.length}`],
  ["/api/news", (j) => JSON.stringify(j).slice(0, 120)],
  ["/api/screener", (j) => JSON.stringify(j).slice(0, 120)],
];
for (const [path, fmt] of api) {
  const r = await get(path);
  if (!r.j) { add(path.split("?")[0], r.s === 405 ? "WARN" : "FAIL", `HTTP ${r.s} ${r.err || r.txt?.slice(0, 80) || ""}`); continue; }
  const bad = r.s >= 400 || r.j.success === false || r.j.error;
  add(path.split("?")[0], bad ? (r.s === 405 ? "WARN" : "FAIL") : "PASS", `${r.ms}ms ${bad ? String(r.j.error || "").slice(0, 120) : fmt(r.j)}`);
}
const c = (l) => out.filter((o) => o.level === l).length;
console.log(`\nSUMMARY  PASS ${c("PASS")}  WARN ${c("WARN")}  FAIL ${c("FAIL")}`);
try { fs.writeFileSync("data/appcheck.json", JSON.stringify({ at: new Date().toISOString(), results: out }, null, 1)); console.log("Saved data/appcheck.json"); } catch {}
