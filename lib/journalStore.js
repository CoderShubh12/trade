// lib/journalStore.js (server only)
// One place that reads/writes data/paper-journal.json, with a lock so the live page, the server engine
// and the reconcile job never overwrite each other's writes.
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "paper-journal.json");
const MAX = 5000;
const g = globalThis;
g.__journalLock = g.__journalLock || Promise.resolve();

export async function readJournal() {
  try { const p = JSON.parse(await fs.readFile(FILE, "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}

async function writeJournal(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list.slice(-MAX), null, 2), "utf8");
  await fs.rename(tmp, FILE);
}

// fn(list) -> new list (or undefined to leave as is). Runs one at a time.
export function updateJournal(fn) {
  const run = g.__journalLock.then(async () => {
    const list = await readJournal();
    const next = await fn(list);
    if (next) await writeJournal(next);
    return next || list;
  });
  g.__journalLock = run.catch(() => {});
  return run;
}

// Insert or merge one call. Same symbol+side+day+entry clock+entry price = the same call.
export function upsertCall(item) {
  return updateJournal((list) => {
    const i = list.findIndex((x) => x.id === item.id || (x.symbol === item.symbol && x.side === item.side && x.dateStr === item.dateStr && x.entryClock === item.entryClock && x.entry === item.entry));
    if (i >= 0) list[i] = { ...list[i], ...item, id: list[i].id }; else list.push(item);
    return list;
  });
}
