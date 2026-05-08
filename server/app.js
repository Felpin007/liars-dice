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
const runtime = require("./runtime-service");

async function handleRequest(req, res) {
  let hydrated = false;
  try {
    setSecurityHeaders(req, res);
    const requestUrl = new URL(req.url, absoluteBaseUrl(req));
    const isApi = requestUrl.pathname.startsWith("/api/");
    if (isApi && runtime.isEnabled() && requestUrl.pathname !== "/api/health" && requestUrl.pathname !== "/api/config") {
      hydrated = await runtime.hydrateState();
    }
    if (rateLimit(req, res, requestUrl.pathname)) return;
    if (isApi && isUnsafeMethod(req.method) && !hasTrustedOrigin(req)) {
      recordAudit(req, "origin_rejected", { origin: String(req.headers.origin || "") });
      json(res, 403, { error: "origin_forbidden" });
      return;
    }
    if (isApi && isUnsafeMethod(req.method) && !hasJsonContentType(req)) {
      recordAudit(req, "content_type_rejected", { contentType: String(req.headers["content-type"] || "") });
      json(res, 415, { error: "json_required" });
      return;
    }
    if (isApi && runtime.isEnabled() && isUnsafeMethod(req.method)) runtime.markDirty();
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
  } finally {
    if (hydrated && runtime.isDirty()) {
      await runtime.persistState().catch((error) => console.warn("[runtime] persist failed", error.message));
    }
  }
}

module.exports = {
  PORT,
  handleRequest,
};
