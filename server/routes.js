const GameServer = require("./authoritative-game");
const { json, recordAudit } = require("./http");
const { readBody, safeText } = require("./utils");
const { inviteLink, publicBaseUrl } = require("./url-utils");
const {
  detachPersistentProfile,
  ensureAuthenticatedClient,
  getSessionFromRequest,
  deleteSessionsForSupabaseUser,
  requireAuthenticatedClient,
} = require("./session-service");
const { sendSse } = require("./realtime");
const lobby = require("./lobby-service");
const persistence = require("./persistence-service");
const moderation = require("./moderation-service");
const qr = require("./qr-service");
const runtime = require("./runtime-service");
const social = require("./social-service");
const pkg = require("../package.json");

async function persistentProfileFromBody(body) {
  if (!body || !body.supabaseAccessToken) return null;
  try {
    const user = await persistence.verifyAccessToken(String(body.supabaseAccessToken));
    return persistence.ensureProfileFromUser(user, body.username);
  } catch (error) {
    console.warn("[auth] Supabase token ignored", error.message);
    return null;
  }
}

async function authenticatedAccountFromBearer(req, res) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  try {
    const user = await persistence.verifyAccessToken(match[1]);
    const profile = await persistence.ensureProfileFromUser(user);
    if (!profile) return null;
    return ensureAuthenticatedClient(req, res, profile.username, profile);
  } catch (error) {
    console.warn("[auth] Supabase bearer rejected", error.message);
    return null;
  }
}

async function requireAccountClient(req, res, options = {}) {
  const bearerAuth = await authenticatedAccountFromBearer(req, res);
  if (bearerAuth) return bearerAuth;
  return requireAuthenticatedClient(req, res, options);
}

function buildSnapshotForRequest(client, session, req) {
  lobby.advanceDueMatches();
  const snapshot = lobby.buildSnapshot(client, session);
  snapshot.links = {
    inviteOrigin: publicBaseUrl(req),
  };
  snapshot.runtime = {
    pollingOnly: runtime.isEnabled(),
  };
  return snapshot;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/config") {
    json(res, 200, {
      supabase: persistence.isConfigured() ? {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        avatarBucket: process.env.SUPABASE_AVATAR_BUCKET || "avatars",
      } : null,
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    const persistenceStatus = await persistence.healthStatus();
    const runtimeStatus = await runtime.healthStatus();
    json(res, 200, {
      ok: true,
      stats: lobby.statsPayload(),
      persistence: persistenceStatus,
      runtime: runtimeStatus,
      version: pkg.version,
      productionReady: Boolean(
        persistenceStatus.configured
        && persistenceStatus.profilesTable
        && persistenceStatus.matchesTables
        && persistenceStatus.socialTables
        && persistenceStatus.avatarBucket
        && runtimeStatus.productionReady
      ),
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/qr") {
    const requestUrl = new URL(req.url, publicBaseUrl(req));
    const svg = await qr.svgForText(requestUrl.searchParams.get("data") || "");
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(svg);
    return true;
  }

  if (req.method === "POST" && pathname === "/api/bootstrap") {
    const body = await readBody(req);
    const persistentProfile = await persistentProfileFromBody(body);
    const { client, session } = ensureAuthenticatedClient(req, res, body.username, persistentProfile);
    if (!persistentProfile) detachPersistentProfile(client);
    const snapshot = buildSnapshotForRequest(client, session, req);
    if (runtime.isEnabled()) {
      await runtime.persistState();
    }
    json(res, 200, snapshot);
    lobby.cleanupState();
    return true;
  }

  if (req.method === "GET" && pathname === "/api/snapshot") {
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    json(res, 200, buildSnapshotForRequest(auth.client, auth.session, req));
    return true;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 200, { profile: null, history: [] });
      return true;
    }
    const bundle = await persistence.getProfileBundle(auth.client.supabaseUserId);
    json(res, 200, bundle || { profile: null, history: [] });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/friends") {
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    json(res, 200, await social.listFriends(auth.client.supabaseUserId));
    return true;
  }

  if (req.method === "POST" && pathname === "/api/friends/request") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    const body = await readBody(req);
    const targetUsername = safeText(body.username, "").slice(0, 32);
    const targetValidation = moderation.validateText(targetUsername, { field: "username", maxLength: 32, allowEmpty: false });
    if (!targetValidation.ok) {
      json(res, 400, { error: targetValidation.error });
      return true;
    }
    const result = await social.sendFriendRequest({
      id: auth.client.supabaseUserId,
      username: auth.client.username,
    }, targetValidation.text);
    if (result.error) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, result);
    return true;
  }

  const friendRespondMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/respond$/);
  if (req.method === "POST" && friendRespondMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    const body = await readBody(req);
    const response = body.response === "accept" ? "accept" : "decline";
    const result = await social.respondFriendRequest({
      id: auth.client.supabaseUserId,
      username: auth.client.username,
    }, friendRespondMatch[1], response);
    if (result.error) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, result);
    return true;
  }

  const friendDeleteMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
  if (req.method === "DELETE" && friendDeleteMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    await social.removeFriend(auth.client.supabaseUserId, friendDeleteMatch[1]);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/notifications") {
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    const notifications = await social.listNotifications(auth.client.supabaseUserId);
    json(res, 200, {
      notifications,
      unread: notifications.filter((item) => !item.readAt).length,
    });
    return true;
  }

  const notificationReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (req.method === "POST" && notificationReadMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    await social.markNotificationRead(auth.client.supabaseUserId, notificationReadMatch[1]);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/notifications/read-all") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    await social.markAllNotificationsRead(auth.client.supabaseUserId);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "PATCH" && pathname === "/api/me") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    const body = await readBody(req);
    const profile = await persistence.updateProfile(auth.client.supabaseUserId, {
      username: body.username,
      displayName: body.displayName,
      bio: body.bio,
      avatarUrl: body.avatarUrl,
    });
    if (profile) {
      auth.client.username = profile.username;
      auth.client.displayName = profile.displayName;
      auth.client.avatarUrl = profile.avatarUrl;
    }
    json(res, 200, { profile });
    return true;
  }

  if (req.method === "DELETE" && pathname === "/api/me") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    if (!auth.client.supabaseUserId) {
      json(res, 401, { error: "login_required" });
      return true;
    }
    await persistence.deleteAccount(auth.client.supabaseUserId);
    deleteSessionsForSupabaseUser(auth.client.supabaseUserId);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/heartbeat") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    json(res, 200, { ok: true, stats: lobby.statsPayload() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    if (runtime.isEnabled()) {
      const auth = await requireAccountClient(req, res, { csrf: false });
      if (!auth) return true;
      json(res, 200, buildSnapshotForRequest(auth.client, auth.session, req));
      return true;
    }
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    const { client, session } = auth;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("\n");
    client.streams.add(res);
    sendSse(res, "bootstrap", buildSnapshotForRequest(client, session, req));
    req.on("close", () => {
      client.streams.delete(res);
    });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/rooms") {
    json(res, 200, { rooms: lobby.listPublicRooms(), stats: lobby.statsPayload() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    const config = body.config || {};
    if (config.matchType === "ranqueada" && !client.supabaseUserId) {
      json(res, 400, { error: "login_required" });
      return true;
    }
    const room = lobby.createRoom(client, body.kind === "challenge" ? "challenge" : "room", config);
    json(res, 200, {
      room: lobby.roomDetails(room, client.id),
      link: inviteLink(req, room.code),
      links: { inviteOrigin: publicBaseUrl(req) },
      stats: lobby.statsPayload(),
    });
    return true;
  }

  const roomJoinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (req.method === "POST" && roomJoinMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const { client } = auth;
    const result = lobby.joinRoom(client, roomJoinMatch[1]);
    if (result.error) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, {
      room: lobby.roomDetails(result.room, client.id),
      link: inviteLink(req, result.room.code),
      links: { inviteOrigin: publicBaseUrl(req) },
      stats: lobby.statsPayload(),
    });
    return true;
  }

  const roomLeaveMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
  if (req.method === "POST" && roomLeaveMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const { client } = auth;
    lobby.leaveRoom(client, roomLeaveMatch[1]);
    json(res, 200, { ok: true, stats: lobby.statsPayload(), rooms: lobby.listPublicRooms() });
    return true;
  }

  const roomStartMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
  if (req.method === "POST" && roomStartMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const { client } = auth;
    const result = lobby.startRoomMatch(client, roomStartMatch[1]);
    if (result.error) {
      json(res, 400, { error: result.error });
      return true;
    }
    json(res, 200, {
      ...lobby.publicMatchPayload(result.match),
      snapshot: GameServer.viewForClient(result.match, client.id),
      stats: lobby.statsPayload(),
    });
    return true;
  }

  const roomInfoMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomInfoMatch) {
    const auth = getSessionFromRequest(req, res);
    const client = auth ? auth.client : null;
    const room = lobby.getRoom(roomInfoMatch[1]);
    if (!room) {
      json(res, 404, { error: "room_not_found" });
      return true;
    }
    json(res, 200, {
      room: lobby.roomDetails(room, client ? client.id : null),
      link: inviteLink(req, room.code),
      links: { inviteOrigin: publicBaseUrl(req) },
      stats: lobby.statsPayload(),
    });
    return true;
  }

  const roomInviteMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/invite$/);
  if (req.method === "POST" && roomInviteMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    const room = lobby.getRoom(roomInviteMatch[1]);
    if (!room) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    if (!room.members.some((member) => member.clientId === client.id)) {
      recordAudit(req, "forbidden", { clientId: client.id, reason: "invite_from_non_member" });
      json(res, 403, { error: "forbidden" });
      return true;
    }
    const invite = lobby.deliverInvite(client, room, safeText(body.username, ""));
    json(res, 200, { ok: true, delivered: invite.delivered });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/queue/join") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    if (client.currentRoomCode) lobby.leaveRoom(client, client.currentRoomCode);
    const queued = lobby.upsertQueueEntry(client, body);
    if (queued.error) {
      json(res, 400, { error: queued.error });
      return true;
    }
    json(res, 200, {
      queue: lobby.isQueueEntryActive(queued.entry.id) ? lobby.queueEntryPayload(queued.entry) : null,
      match: queued.match,
      stats: lobby.statsPayload(),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/queue/leave") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    lobby.removeQueueEntry(auth.client.id);
    json(res, 200, { ok: true, stats: lobby.statsPayload() });
    return true;
  }

  const matchActionMatch = pathname.match(/^\/api\/match\/([^/]+)\/action$/);
  const matchInfoMatch = pathname.match(/^\/api\/match\/([^/]+)$/);
  if (req.method === "GET" && matchInfoMatch) {
    const auth = await requireAccountClient(req, res, { csrf: false });
    if (!auth) return true;
    const { client } = auth;
    const match = lobby.getMatch(matchInfoMatch[1]);
    if (!match || !GameServer.humanClientIds(match).includes(client.id)) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    lobby.advanceMatchIfDue(match);
    json(res, 200, {
      ...lobby.publicMatchPayload(match),
      snapshot: GameServer.viewForClient(match, client.id),
      stats: lobby.statsPayload(),
    });
    return true;
  }

  if (req.method === "POST" && matchActionMatch) {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    const match = lobby.getMatch(matchActionMatch[1]);
    if (!match) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    lobby.advanceMatchIfDue(match);
    const sender = match.humanPlayers.find((player) => player.clientId === client.id);
    if (!sender || sender.seat !== body.seat) {
      recordAudit(req, "forbidden", { clientId: client.id, matchId: match.id, reason: "seat_mismatch" });
      json(res, 403, { error: "forbidden" });
      return true;
    }
    const result = GameServer.applyAction(match, sender.seat, body.action);
    if (!result.ok) {
      json(res, 400, { error: result.error });
      return true;
    }
    lobby.pushMatchSnapshot(match);
    lobby.scheduleAuthoritativeMatch(match);
    json(res, 200, {
      ok: true,
      snapshot: GameServer.viewForClient(match, client.id),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/reports") {
    const auth = await requireAccountClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const reason = safeText(body.reason, "").slice(0, 80);
    const targetUsername = safeText(body.targetUsername, "").slice(0, 64);
    const targetClientId = safeText(body.targetClientId, "").slice(0, 80);
    const reasonValidation = moderation.validateText(reason, { field: "reason", maxLength: 80, allowEmpty: false, rejectLinks: false });
    const targetValidation = moderation.validateText(targetUsername, { field: "target", maxLength: 64, allowEmpty: true });
    const detailsValidation = moderation.validateText(body.details || "", { field: "details", maxLength: 1000, allowEmpty: true });
    if (!reasonValidation.ok || !targetValidation.ok || !detailsValidation.ok || (!targetUsername && !targetClientId)) {
      json(res, 400, { error: "invalid_report" });
      return true;
    }
    const result = await runtime.createReport({
      reporterClientId: auth.client.id,
      reporterProfileId: auth.client.supabaseUserId || null,
      targetUsername: targetValidation.text,
      targetClientId,
      matchId: safeText(body.matchId, "").slice(0, 80),
      reason: reasonValidation.text,
      details: detailsValidation.text,
    });
    if (auth.client.supabaseUserId) {
      await social.createNotification(auth.client.supabaseUserId, "report_created", "Report registrado", "Obrigado. O report ficou na fila de revisão.", { matchId: body.matchId || null });
    }
    json(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/cron/cleanup") {
    const expected = process.env.CRON_SECRET || "";
    const actual = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!expected || actual !== expected) {
      json(res, 401, { error: "unauthorized" });
      return true;
    }
    lobby.advanceDueMatches();
    lobby.cleanupState();
    const cleaned = await runtime.cleanupRuntimeTables();
    runtime.markDirty();
    json(res, 200, { ok: true, ...cleaned });
    return true;
  }

  return false;
}

module.exports = {
  handleApi,
};
