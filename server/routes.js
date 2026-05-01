const GameServer = require("./authoritative-game");
const { json, recordAudit } = require("./http");
const { readBody, safeText } = require("./utils");
const { inviteLink, publicBaseUrl } = require("./url-utils");
const {
  ensureAuthenticatedClient,
  getSessionFromRequest,
  requireAuthenticatedClient,
} = require("./session-service");
const { sendSse } = require("./realtime");
const lobby = require("./lobby-service");

function buildSnapshotForRequest(client, session, req) {
  const snapshot = lobby.buildSnapshot(client, session);
  snapshot.links = {
    inviteOrigin: publicBaseUrl(req),
  };
  return snapshot;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, { ok: true, stats: lobby.statsPayload() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/bootstrap") {
    const body = await readBody(req);
    const { client, session } = ensureAuthenticatedClient(req, res, body.username);
    json(res, 200, buildSnapshotForRequest(client, session, req));
    lobby.cleanupState();
    return true;
  }

  if (req.method === "POST" && pathname === "/api/heartbeat") {
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    json(res, 200, { ok: true, stats: lobby.statsPayload() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const auth = requireAuthenticatedClient(req, res, { csrf: false });
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
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    const room = lobby.createRoom(client, body.kind === "challenge" ? "challenge" : "room", body.config || {});
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
    const auth = requireAuthenticatedClient(req, res);
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
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    const { client } = auth;
    lobby.leaveRoom(client, roomLeaveMatch[1]);
    json(res, 200, { ok: true, stats: lobby.statsPayload(), rooms: lobby.listPublicRooms() });
    return true;
  }

  const roomStartMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/start$/);
  if (req.method === "POST" && roomStartMatch) {
    const auth = requireAuthenticatedClient(req, res);
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
    const auth = requireAuthenticatedClient(req, res);
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
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    if (client.currentRoomCode) lobby.leaveRoom(client, client.currentRoomCode);
    const queued = lobby.upsertQueueEntry(client, body);
    json(res, 200, {
      queue: lobby.isQueueEntryActive(queued.entry.id) ? lobby.queueEntryPayload(queued.entry) : null,
      match: queued.match,
      stats: lobby.statsPayload(),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/queue/leave") {
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    lobby.removeQueueEntry(auth.client.id);
    json(res, 200, { ok: true, stats: lobby.statsPayload() });
    return true;
  }

  const matchActionMatch = pathname.match(/^\/api\/match\/([^/]+)\/action$/);
  if (req.method === "POST" && matchActionMatch) {
    const auth = requireAuthenticatedClient(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const { client } = auth;
    const match = lobby.getMatch(matchActionMatch[1]);
    if (!match) {
      json(res, 404, { error: "not_found" });
      return true;
    }
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

  return false;
}

module.exports = {
  handleApi,
};
