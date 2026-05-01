const http = require("node:http");
const { URL } = require("node:url");
const { PORT } = require("./config");
const {
  json,
  rateLimit,
  recordAudit,
  setSecurityHeaders,
} = require("./http");
const {
  hasJsonContentType,
  isUnsafeMethod,
} = require("./utils");
const {
  absoluteBaseUrl,
  hasTrustedOrigin,
} = require("./url-utils");
const { handleApi } = require("./routes");
const { serveStatic } = require("./static-service");
const { cleanupState } = require("./lobby-service");

if (!process.env.SESSION_SECRET) {
  console.warn("[security] SESSION_SECRET ausente; sessoes serao invalidadas a cada reinicio do servidor.");
}

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(req, res);
    const requestUrl = new URL(req.url, absoluteBaseUrl(req));
    if (rateLimit(req, res, requestUrl.pathname)) return;
    if (requestUrl.pathname.startsWith("/api/") && isUnsafeMethod(req.method) && !hasTrustedOrigin(req)) {
      recordAudit(req, "origin_rejected", { origin: String(req.headers.origin || "") });
      json(res, 403, { error: "origin_forbidden" });
      return;
    }
    if (requestUrl.pathname.startsWith("/api/") && isUnsafeMethod(req.method) && !hasJsonContentType(req)) {
      recordAudit(req, "content_type_rejected", { contentType: String(req.headers["content-type"] || "") });
      json(res, 415, { error: "json_required" });
      return;
    }
    const handled = await handleApi(req, res, requestUrl.pathname);
    if (handled) return;
    serveStatic(req, res, requestUrl.pathname);
  } catch (error) {
    if (error && error.statusCode) {
      json(res, error.statusCode, { error: error.publicCode || "bad_request" });
      return;
    }
    console.error(error);
    json(res, 500, { error: "internal_error" });
  }
});

setInterval(cleanupState, 10_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Liar's Dice Arena server on http://localhost:${PORT}`);
});
