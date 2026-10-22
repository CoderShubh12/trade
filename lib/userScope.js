// lib/userScope.js - per-user data files for up to 5 logins.
// The OWNER (APP_LOGIN_USER) keeps the existing files in data/ so nothing existing moves.
// Every other user gets their own copy under data/users/<name>/ (journal, watchlist), so users never see or overwrite each other.
// The automated server engine runs for the OWNER only.
import path from "path";

export const MAX_USERS = 5;
export const safeUser = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
export const ownerName = () => safeUser(process.env.APP_LOGIN_USER);

// All allowed logins: the owner (APP_LOGIN_USER/APP_LOGIN_PASSWORD) plus APP_USERS="name:password;name2:password2" (max 5 total).
export function loadUsers(env = process.env) {
  const list = [];
  if (env.APP_LOGIN_USER && env.APP_LOGIN_PASSWORD) list.push({ name: env.APP_LOGIN_USER, pass: env.APP_LOGIN_PASSWORD, role: "owner" });
  for (const part of String(env.APP_USERS || "").split(";")) {
    const i = part.indexOf(":");
    if (i < 1) continue;
    const name = part.slice(0, i).trim(), pass = part.slice(i + 1);
    if (!name || !pass || safeUser(name) !== name.toLowerCase() || list.some((u) => safeUser(u.name) === safeUser(name))) continue;
    list.push({ name, pass, role: "user" });
  }
  return list.slice(0, MAX_USERS);
}

// base = "paper-journal.json" etc. Owner (or no user) -> data/<base>; others -> data/users/<user>/<base>.
export function userFile(user, base) {
  const u = safeUser(user);
  if (!u || u === ownerName()) return path.join(process.cwd(), "data", base);
  return path.join(process.cwd(), "data", "users", u, base);
}

// middleware sets x-app-user from the signed cookie (and overwrites anything the client sent)
export const requestUser = (request) => safeUser(request.headers.get("x-app-user"));
