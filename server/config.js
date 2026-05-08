const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");

const ROOT_DIR = path.resolve(__dirname, "..");

function loadDotEnv() {
  const filePath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    if (process.env[key] != null) continue;
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 8080);
const IS_VERCEL = process.env.VERCEL === "1";
const NODE_ENV = process.env.NODE_ENV || "development";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";
const CLIENT_TTL_MS = 75_000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MATCH_TTL_MS = 60 * 60 * 1000;
const QUICKMATCH_TARGET_PLAYERS = 4;
const QUICKMATCH_BOT_FILL_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const SESSION_COOKIE = "lda_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const AUDIT_LOG_LIMIT = 500;
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const BOT_NAMES = ["Alice", "Bob", "Carla", "Diego", "Eva", "Fátima", "Gael", "Helena"];

module.exports = {
  ROOT_DIR,
  PORT,
  IS_VERCEL,
  NODE_ENV,
  PUBLIC_BASE_URL,
  CRON_SECRET,
  CLIENT_TTL_MS,
  ROOM_TTL_MS,
  MATCH_TTL_MS,
  QUICKMATCH_TARGET_PLAYERS,
  QUICKMATCH_BOT_FILL_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_SECRET,
  AUDIT_LOG_LIMIT,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_AVATAR_BUCKET,
  MIME_TYPES,
  BOT_NAMES,
};
