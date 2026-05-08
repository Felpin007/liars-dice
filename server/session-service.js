const crypto = require("node:crypto");
const state = require("./state");
const {
  CLIENT_TTL_MS,
  SESSION_COOKIE,
  SESSION_SECRET,
  SESSION_TTL_MS,
} = require("./config");
const { json, recordAudit } = require("./http");
const { isHttpsRequest } = require("./url-utils");
const {
  isUnsafeMethod,
  randomId,
  safeText,
  timingSafeEqualText,
} = require("./utils");

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const rawValue = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function hmac(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function signSessionId(sessionId) {
  return `${sessionId}.${hmac(sessionId)}`;
}

function verifySignedSession(value) {
  const signed = String(value || "");
  const splitAt = signed.lastIndexOf(".");
  if (splitAt <= 0) return null;
  const sessionId = signed.slice(0, splitAt);
  const signature = signed.slice(splitAt + 1);
  return timingSafeEqualText(signature, hmac(sessionId)) ? sessionId : null;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function appendCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function setSessionCookie(req, res, session) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, signSessionId(session.id), {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "Lax",
    secure: isHttpsRequest(req),
  }));
}

function activeClients() {
  const now = Date.now();
  return Array.from(state.clients.values()).filter((client) => now - client.lastSeenAt <= CLIENT_TTL_MS);
}

function normalizeName(name) {
  return safeText(name, "").replace(/[^\p{L}\p{N}_\- ]/gu, "").trim();
}

function uniqueUsername(requestedName) {
  const base = normalizeName(requestedName) || `Jogador-${crypto.randomBytes(2).toString("hex")}`;
  let candidate = base;
  let suffix = 2;
  const taken = new Set(activeClients().map((client) => client.username.toLowerCase()));
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function createClient(preferredName, persistentProfile = null) {
  const id = randomId("c_");
  const client = {
    id,
    username: uniqueUsername(persistentProfile?.username || preferredName),
    displayName: persistentProfile?.displayName || "",
    avatarUrl: persistentProfile?.avatarUrl || "",
    supabaseUserId: persistentProfile?.id || null,
    rating: persistentProfile?.rating || 1500,
    ratingDeviation: persistentProfile?.ratingDeviation || 350,
    level: persistentProfile?.level || 1,
    xp: persistentProfile?.xp || 0,
    lastSeenAt: Date.now(),
    streams: new Set(),
    currentRoomCode: null,
    queueEntryId: null,
    activeMatchId: null,
    notifications: [],
  };
  state.clients.set(id, client);
  return client;
}

function attachPersistentProfile(client, persistentProfile = null) {
  if (!client || !persistentProfile) return client;
  client.supabaseUserId = persistentProfile.id || client.supabaseUserId || null;
  client.username = persistentProfile.username || client.username;
  client.displayName = persistentProfile.displayName || client.displayName || "";
  client.avatarUrl = persistentProfile.avatarUrl || client.avatarUrl || "";
  client.rating = persistentProfile.rating || client.rating || 1500;
  client.ratingDeviation = persistentProfile.ratingDeviation || client.ratingDeviation || 350;
  client.level = persistentProfile.level || client.level || 1;
  client.xp = persistentProfile.xp || client.xp || 0;
  touchClient(client);
  return client;
}

function detachPersistentProfile(client) {
  if (!client) return client;
  client.supabaseUserId = null;
  client.displayName = "";
  client.avatarUrl = "";
  touchClient(client);
  return client;
}

function touchClient(client) {
  client.lastSeenAt = Date.now();
}

function createSession(client) {
  const now = Date.now();
  const session = {
    id: randomId("s_", 32),
    clientId: client.id,
    csrfToken: randomId("csrf_", 32),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  state.sessions.set(session.id, session);
  return session;
}

function deleteSessionsForClient(clientId) {
  for (const [sessionId, session] of state.sessions.entries()) {
    if (session.clientId === clientId) state.sessions.delete(sessionId);
  }
}

function deleteSessionsForSupabaseUser(supabaseUserId) {
  if (!supabaseUserId) return;
  for (const client of state.clients.values()) {
    if (client.supabaseUserId !== supabaseUserId) continue;
    deleteSessionsForClient(client.id);
    detachPersistentProfile(client);
    client.username = uniqueUsername("Conta excluída");
  }
}

function getSessionFromRequest(req, res = null) {
  const sessionId = verifySignedSession(parseCookies(req)[SESSION_COOKIE]);
  if (!sessionId) return null;

  const session = state.sessions.get(sessionId);
  if (!session) {
    recordAudit(req, "invalid_session");
    return null;
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    state.sessions.delete(sessionId);
    recordAudit(req, "expired_session", { sessionId: sessionId.slice(0, 10) });
    return null;
  }

  const client = state.clients.get(session.clientId);
  if (!client) {
    state.sessions.delete(sessionId);
    recordAudit(req, "orphan_session", { sessionId: sessionId.slice(0, 10) });
    return null;
  }

  session.lastSeenAt = now;
  session.expiresAt = now + SESSION_TTL_MS;
  touchClient(client);
  if (res) setSessionCookie(req, res, session);
  return { client, session };
}

function ensureAuthenticatedClient(req, res, preferredName, persistentProfile = null) {
  const existing = getSessionFromRequest(req, res);
  if (existing) {
    attachPersistentProfile(existing.client, persistentProfile);
    return existing;
  }

  const client = createClient(preferredName, persistentProfile);
  const session = createSession(client);
  setSessionCookie(req, res, session);
  recordAudit(req, "session_created", { clientId: client.id });
  return { client, session };
}

function requireAuthenticatedClient(req, res, options = {}) {
  const auth = getSessionFromRequest(req, res);
  if (!auth) {
    recordAudit(req, "auth_required");
    json(res, 401, { error: "auth_required" });
    return null;
  }

  if (options.csrf !== false && isUnsafeMethod(req.method)) {
    const token = String(req.headers["x-csrf-token"] || "");
    if (!token || !timingSafeEqualText(token, auth.session.csrfToken)) {
      recordAudit(req, "csrf_rejected", { clientId: auth.client.id });
      json(res, 403, { error: "csrf_required" });
      return null;
    }
  }

  return auth;
}

module.exports = {
  activeClients,
  attachPersistentProfile,
  detachPersistentProfile,
  touchClient,
  deleteSessionsForClient,
  deleteSessionsForSupabaseUser,
  getSessionFromRequest,
  ensureAuthenticatedClient,
  requireAuthenticatedClient,
};
