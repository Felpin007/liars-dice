const os = require("node:os");
const { PORT, PUBLIC_BASE_URL } = require("./config");

function isHttpsRequest(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || Boolean(req.socket.encrypted);
}

function isPrivateIpv4(address) {
  return /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}

function lanIpv4Address() {
  const candidates = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.address) continue;
      if (entry.address.startsWith("169.254.")) continue;
      const score = entry.address.startsWith("192.168.") ? 0
        : entry.address.startsWith("10.") ? 1
          : /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address) ? 2
            : 3;
      candidates.push({ address: entry.address, score });
    }
  }
  candidates.sort((left, right) => left.score - right.score || left.address.localeCompare(right.address));
  return candidates.find((candidate) => isPrivateIpv4(candidate.address))?.address
    || candidates[0]?.address
    || null;
}

function isLoopbackHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function absoluteBaseUrl(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${req.headers.host || `localhost:${PORT}`}`;
}

function publicBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const base = new URL(absoluteBaseUrl(req));
  if (isLoopbackHostname(base.hostname)) {
    const lanAddress = lanIpv4Address();
    if (lanAddress) base.hostname = lanAddress;
  }
  return base.origin;
}

function inviteLink(req, code) {
  return `${publicBaseUrl(req)}/invite/${encodeURIComponent(code)}`;
}

function hasTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(absoluteBaseUrl(req)).origin;
  } catch {
    return false;
  }
}

module.exports = {
  isHttpsRequest,
  absoluteBaseUrl,
  publicBaseUrl,
  inviteLink,
  hasTrustedOrigin,
};
