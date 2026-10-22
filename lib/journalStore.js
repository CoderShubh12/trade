// lib/journalStore.js (server only)
// One place that reads/writes data/paper-journal.json, with a lock so the live page, the server engine
// and the reconcile job never overwrite each other's writes.
import { promises as fs } from "fs";
import path from "path";
import { maybeBackup } from "./safetyBots.js";
import { userFile, ownerName, safeUser } from "./userScope.js";

const fileFor = (user) => userFile(user, "paper-journal.json");
const isOwner = (user) => !safeUser(user) || safeUser(user) === ownerName();
const MAX = 5000;
const g = globalThis;
g.__journalLocks = g.__journalLocks || new Map(); // one lock per journal file

export async function readJournal(user) {
  try { const p = JSON.parse(await fs.readFile(fileFor(user), "utf8")); return Array.isArray(p) ? p : []; } catch { return []; }
}

async function writeJournal(list, user) {
  const FILE = fileFor(user);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list.slice(-MAX), null, 2), "utf8");
  await fs.rename(tmp, FILE);
  if (isOwner(user)) maybeBackup("journal-write"); // throttled snapshot; never throws
}

// fn(list) -> new list (or undefined to leave as is). Runs one at a time.
export function updateJournal(fn, user) {
  const key = fileFor(user);
  const prev = g.__journalLocks.get(key) || Promise.resolve();
  const run = prev.then(async () => {
    const list = await readJournal(user);
    const next = await fn(list);
    if (next) await writeJournal(next, user);
    return next || list;
  });
  g.__journalLocks.set(key, run.catch(() => {}));
  return run;
}

// Insert or merge one call. Same symbol+side+day+entry clock+entry price = the same call.
export function upsertCall(item, user) {
  return updateJournal((list) => {
    const i = list.findIndex((x) => x.id === item.id || (x.symbol === item.symbol && x.side === item.side && x.dateStr === item.dateStr && x.entryClock === item.entryClock && x.entry === item.entry));
    if (i >= 0) list[i] = { ...list[i], ...item, id: list[i].id }; else list.push(item);
    return list;
  }, user);
}
