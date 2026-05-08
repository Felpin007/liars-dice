const { URL } = require("node:url");
const state = require("./state");
const {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  AUDIT_LOG_LIMIT,
} = require("./config");
const { absoluteBaseUrl, isHttpsRequest } = require("./url-utils");

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function setSecurityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (req && isHttpsRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://api.qrserver.com https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateLimit(req, res, pathname) {
  if (!pathname.startsWith("/api/")) return false;
  const now = Date.now();
  const category = rateLimitCategory(req.method, pathname);
  const limit = category.limit;
  const key = `${clientAddress(req)}:${category.key}`;
  const entry = state.rateLimits.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  state.rateLimits.set(key, entry);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  if (entry.count <= limit) return false;
  json(res, 429, { error: "rate_limited" });
  return true;
}

function rateLimitCategory(method, pathname) {
  if (pathname === "/api/bootstrap") return { key: "bootstrap", limit: 60 };
  if (pathname === "/api/snapshot" || /^\/api\/match\/[^/]+$/.test(pathname)) return { key: "polling", limit: 180 };
  if (pathname === "/api/rooms" && method === "POST") return { key: "rooms-create", limit: 30 };
  if (/^\/api\/match\/[^/]+\/action$/.test(pathname)) return { key: "match-action", limit: 120 };
  if (pathname === "/api/me") return { key: "profile", limit: 60 };
  if (pathname === "/api/reports") return { key: "reports", limit: 20 };
  return { key: pathname, limit: RATE_LIMIT_MAX_REQUESTS };
}

function recordAudit(req, type, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    type,
    ip: clientAddress(req),
    method: req.method,
    path: (() => {
      try {
        return new URL(req.url, absoluteBaseUrl(req)).pathname;
      } catch {
        return req.url || "";
      }
    })(),
    ...details,
  };
  state.auditLog.push(entry);
  if (state.auditLog.length > AUDIT_LOG_LIMIT) state.auditLog.shift();
  if (["auth_required", "csrf_rejected", "origin_rejected", "forbidden"].includes(type)) {
    console.warn(`[security] ${type}`, JSON.stringify(entry));
  }
}

module.exports = {
  json,
  setSecurityHeaders,
  clientAddress,
  rateLimit,
  recordAudit,
};
