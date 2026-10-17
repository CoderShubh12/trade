// Tests for lib/safetyBots.js (backup + journal integrity). Runs in a temp folder, never touches real data.
import fs from "fs"; import os from "os"; import path from "path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "safety-")); process.chdir(tmp); fs.mkdirSync("data");
const { checkJournal, backupNow, backupStatus, maybeBackup, evaluateHealth } = await import(path.resolve(import.meta.dirname, "../lib/safetyBots.js"));
let fail = 0; const t = (n, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; };
const good = { id: "1-3045", symbol: "SBIN", side: "SELL", dateStr: "2026-10-12", entryClock: "09:45", entry: 947.65, stopLoss: 952.2, initialSl: 952.2, target1: 940.07, target2: 934.38, exitPrice: 940.07, exitClock: "11:00", reason: "T1_SERVER", r: 1.666, token: "3045" };
const NOW = Date.parse("2026-10-13T06:00:00Z");
t("clean row passes", checkJournal([good], NOW).ok && checkJournal([good], NOW).issues.length === 0);
const codes = (rows) => checkJournal(rows, NOW).issues.map((i) => i.code);
t("duplicate id", codes([good, { ...good }]).includes("DUP_ID"));
t("same call stored twice", codes([good, { ...good, id: "2-3045" }]).includes("DUP_CALL"));
t("bad levels (SELL with stop below entry)", codes([{ ...good, initialSl: 940, stopLoss: 940 }]).includes("BAD_LEVELS"));
t("exit before entry", codes([{ ...good, exitClock: "09:30" }]).includes("EXIT_BEFORE_ENTRY"));
t("r mismatch", codes([{ ...good, r: 4.2 }]).includes("R_MISMATCH"));
t("missing token (warn only)", (() => { const r = checkJournal([{ ...good, token: undefined }], NOW); return r.ok && r.issues.some((i) => i.code === "NO_TOKEN"); })());
t("stale open trade", codes([{ ...good, exitPrice: null, exitClock: "", reason: "", r: null }]).includes("STALE_OPEN"));
t("open trade today is fine", !codes([{ ...good, exitPrice: null, exitClock: "", reason: "", r: null, dateStr: "2026-10-13" }]).includes("STALE_OPEN"));
t("bad entry", codes([{ ...good, entry: -3 }]).includes("BAD_ENTRY"));
t("not an array", checkJournal({}).ok === false);
// backup
fs.writeFileSync("data/paper-journal.json", JSON.stringify([good]));
const r1 = await backupNow("test");
t("backup written", r1.made && r1.made.length === 1 && fs.readdirSync("data/backups").length === 1);
fs.writeFileSync("data/paper-journal.json", "{corrupt");
const r2 = await backupNow("test");
t("corrupt journal is NOT backed up", !r2.made || r2.made.length === 0);
fs.writeFileSync("data/paper-journal.json", JSON.stringify([good]));
for (let i = 0; i < 3; i++) { await backupNow("loop"); await new Promise((r) => setTimeout(r, 1100)); }
const st = await backupStatus();
t("status lists latest file", st.count >= 3 && st.latest["paper-journal"]);
const before = fs.readdirSync("data/backups").length; maybeBackup("throttled"); await new Promise((r) => setTimeout(r, 300));
t("maybeBackup is throttled (no new file within 10 min)", fs.readdirSync("data/backups").length === before);
// Data Health Bot rules
const H = (o) => evaluateHealth({ marketOpen: true, candleFails: 0, candlePauseSec: 0, quoteError: "", tickAgeSec: 2, integrityErrors: 0, ...o });
t("healthy feed -> ok", H({}).level === "ok");
t("market closed -> ok (checks off)", H({ marketOpen: false, candleFails: 9, tickAgeSec: 999 }).level === "ok");
t("1 candle failure -> still ok", H({ candleFails: 1 }).level === "ok");
t("2 candle failures -> degraded", H({ candleFails: 2 }).level === "degraded");
t("3 candle failures -> down", H({ candleFails: 3 }).level === "down");
t("tick 30s old -> degraded", H({ tickAgeSec: 30 }).level === "degraded");
t("tick 90s old -> down", H({ tickAgeSec: 90 }).level === "down");
t("no tick yet -> degraded", H({ tickAgeSec: null }).level === "degraded");
t("quote error -> degraded", H({ quoteError: "403" }).level === "degraded");
t("journal errors block even when market closed", H({ marketOpen: false, integrityErrors: 2 }).level === "down");
t("worst level wins", H({ candleFails: 2, tickAgeSec: 100 }).level === "down");
process.exit(fail ? 1 : 0);
