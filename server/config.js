const path = require("node:path");
const crypto = require("node:crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8080);
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
  MIME_TYPES,
  BOT_NAMES,
};
