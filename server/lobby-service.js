const crypto = require("node:crypto");
const GameServer = require("./authoritative-game");
const state = require("./state");
const {
  BOT_NAMES,
  CLIENT_TTL_MS,
  MATCH_TTL_MS,
  QUICKMATCH_BOT_FILL_MS,
  QUICKMATCH_TARGET_PLAYERS,
  ROOM_TTL_MS,
} = require("./config");
const { randomId, randomInviteCode, safeText } = require("./utils");
const {
  activeClients,
  deleteSessionsForClient,
  touchClient,
} = require("./session-service");
const { broadcast, pushToClient } = require("./realtime");
const persistence = require("./persistence-service");
const runtime = require("./runtime-service");

const RESOLUTION_REVEAL_MS = 10000;

function statsPayload() {
  const activeClientIds = new Set(activeClients().map((client) => client.id));
  const activeRooms = Array.from(state.rooms.values()).filter((room) => room.members.some((member) => activeClientIds.has(member.clientId)));
  const activeMatches = Array.from(state.matches.values()).filter((match) => (
    match.phase !== "ended"
    && Date.now() - match.createdAt <= MATCH_TTL_MS
    && match.humanPlayers.some((player) => activeClientIds.has(player.clientId))
  ));
  return {
    online: activeClientIds.size,
    matches: activeRooms.length + activeMatches.length,
  };
}

function publicRoomSummary(room) {
  return {
    code: room.code,
    title: room.title,
    description: room.description,
    hostName: room.hostName,
    hostAvatarUrl: room.hostAvatarUrl,
    kind: room.kind,
    gameType: room.config.gameType,
    minutes: room.config.minutes,
    increment: room.config.increment,
    matchType: room.config.matchType,
    maxPlayers: room.maxPlayers,
    memberCount: room.members.length,
    createdAt: room.createdAt,
  };
}

function roomDetails(room, viewer = null) {
  const viewerId = typeof viewer === "object" ? viewer?.id : viewer;
  const viewerSupabaseUserId = typeof viewer === "object" ? viewer?.supabaseUserId : null;
  return {
    ...publicRoomSummary(room),
    linkPath: `/invite/${room.code}`,
    members: room.members.map((member) => ({
      clientId: member.clientId,
      username: member.username,
      avatarUrl: member.avatarUrl || "",
      isHost: member.clientId === room.hostClientId,
    })),
    canJoin: room.status === "waiting" && room.members.length < room.maxPlayers && !room.members.some((member) => (
      member.clientId === viewerId || (viewerSupabaseUserId && member.supabaseUserId === viewerSupabaseUserId)
    )),
    isMember: room.members.some((member) => member.clientId === viewerId || (viewerSupabaseUserId && member.supabaseUserId === viewerSupabaseUserId)),
    isHost: room.hostClientId === viewerId || Boolean(room.hostSupabaseUserId && viewerSupabaseUserId && room.hostSupabaseUserId === viewerSupabaseUserId),
  };
}

function isRoomHost(room, client) {
  if (!room || !client) return false;
  if (room.hostClientId === client.id) return true;
  if (room.hostSupabaseUserId && client.supabaseUserId && room.hostSupabaseUserId === client.supabaseUserId) return true;
  const hostMember = room.members.find((member) => member.clientId === room.hostClientId);
  return Boolean(hostMember?.supabaseUserId && client.supabaseUserId && hostMember.supabaseUserId === client.supabaseUserId);
}

function attachClientToExistingMember(room, client) {
  if (!room || !client?.supabaseUserId) return;
  const member = room.members.find((candidate) => candidate.supabaseUserId === client.supabaseUserId);
  if (!member) return;
  if (room.hostClientId === member.clientId) room.hostClientId = client.id;
  member.clientId = client.id;
  member.username = client.username || member.username;
  member.avatarUrl = client.avatarUrl || member.avatarUrl || "";
  client.currentRoomCode = room.code;
}

function listPublicRooms() {
  return Array.from(state.rooms.values())
    .filter((room) => room.visibility === "public")
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicRoomSummary);
}

function emitHomeUpdate() {
  broadcast("home.update", {
    stats: statsPayload(),
    rooms: listPublicRooms(),
  });
}

function buildRoomTitle(kind, hostName) {
  return kind === "challenge" ? `Desafio de ${hostName}` : `Sala de ${hostName}`;
}

function gameTypeLabel(gameType) {
  return {
    "classic-4": "Clássico",
    "duel-2": "Duelo",
    "arena-6": "Arena",
    "private-4": "Privada",
  }[gameType] || "Clássico";
}

function buildRoomDescription(config) {
  const mode = config.matchType === "ranqueada" ? "Ranqueada" : "Amistosa";
  return `${gameTypeLabel(config.gameType)} · ${config.minutes}+${config.increment} · ${mode}`;
}

function maxPlayersForType(gameType) {
  const match = String(gameType || "").match(/-(\d+)$/);
  return match ? Math.max(2, Math.min(6, Number(match[1]))) : 4;
}

function createRoom(client, kind, config) {
  removeQueueEntry(client.id);

  if (client.currentRoomCode) {
    leaveRoom(client, client.currentRoomCode);
  }

  const code = randomInviteCode();
  const room = {
    code,
    kind,
    visibility: kind === "challenge" ? "private" : "public",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "waiting",
    hostClientId: client.id,
    hostSupabaseUserId: client.supabaseUserId || null,
    hostName: client.username,
    hostAvatarUrl: client.avatarUrl || "",
    maxPlayers: maxPlayersForType(config.gameType),
    title: buildRoomTitle(kind, client.username),
    description: buildRoomDescription(config),
    config: {
      gameType: safeText(config.gameType, "classic-4"),
      minutes: Math.max(1, Math.min(30, Number(config.minutes) || 5)),
      increment: Math.max(0, Math.min(30, Number(config.increment) || 0)),
      matchType: config.matchType === "ranqueada" ? "ranqueada" : "amistosa",
    },
    members: [{
      clientId: client.id,
      username: client.username,
      supabaseUserId: client.supabaseUserId || null,
      avatarUrl: client.avatarUrl || "",
      joinedAt: Date.now(),
    }],
  };
  state.rooms.set(code, room);
  client.currentRoomCode = code;
  emitHomeUpdate();
  pushRoomUpdate(room);
  return room;
}

function pushRoomUpdate(room) {
  const payload = {
    room: roomDetails(room),
    stats: statsPayload(),
    rooms: listPublicRooms(),
  };
  for (const member of room.members) {
    pushToClient(member.clientId, "room.update", payload);
  }
}

function joinRoom(client, code) {
  const room = state.rooms.get(code);
  if (!room) return { error: "Sala não encontrada." };
  if (room.status !== "waiting") return { error: "Essa sala não aceita mais entradas." };
  if (room.config.matchType === "ranqueada" && !client.supabaseUserId) return { error: "login_required" };
  attachClientToExistingMember(room, client);
  if (room.members.some((member) => member.clientId === client.id)) {
    touchClient(client);
    pushRoomUpdate(room);
    return { room };
  }
  if (room.members.length >= room.maxPlayers) return { error: "Essa sala já está cheia." };

  removeQueueEntry(client.id);

  if (client.currentRoomCode && client.currentRoomCode !== code) {
    leaveRoom(client, client.currentRoomCode);
  }

  room.members.push({
    clientId: client.id,
    username: client.username,
    supabaseUserId: client.supabaseUserId || null,
    avatarUrl: client.avatarUrl || "",
    joinedAt: Date.now(),
  });
  room.updatedAt = Date.now();
  client.currentRoomCode = code;
  emitHomeUpdate();
  pushRoomUpdate(room);
  return { room };
}

function leaveRoom(client, code) {
  const room = state.rooms.get(code);
  if (!room) return;
  room.members = room.members.filter((member) => member.clientId !== client.id);
  room.updatedAt = Date.now();
  client.currentRoomCode = client.currentRoomCode === code ? null : client.currentRoomCode;

  if (!room.members.length) {
    state.rooms.delete(code);
  } else {
    if (room.hostClientId === client.id) {
      room.hostClientId = room.members[0].clientId;
      room.hostSupabaseUserId = room.members[0].supabaseUserId || null;
      room.hostName = room.members[0].username;
      room.hostAvatarUrl = room.members[0].avatarUrl || "";
      room.title = buildRoomTitle(room.kind, room.hostName);
    }
    pushRoomUpdate(room);
  }

  emitHomeUpdate();
}

function deliverInvite(fromClient, room, targetUsername) {
  const normalized = targetUsername.trim().toLowerCase();
  if (!normalized) return { delivered: false };
  const target = activeClients().find((client) => client.username.toLowerCase() === normalized);
  if (!target) return { delivered: false };
  if (target.supabaseUserId) {
    require("./social-service").createNotification(
      target.supabaseUserId,
      "invite_received",
      "Convite recebido",
      `${fromClient.username} enviou um convite.`,
      { roomCode: room.code, from: fromClient.username }
    ).catch((error) => console.warn("[notifications] invite failed", error.message));
  }
  pushToClient(target.id, "invite.received", {
    room: publicRoomSummary(room),
    from: fromClient.username,
    code: room.code,
    linkPath: `/invite/${room.code}`,
  });
  return { delivered: true, target };
}

function queueEntryPayload(entry) {
  return {
    id: entry.id,
    label: entry.label,
    modeKey: entry.modeKey,
    minutes: entry.minutes,
    increment: entry.increment,
    matchType: entry.matchType || "amistosa",
    joinedAt: entry.joinedAt,
  };
}

function upsertQueueEntry(client, body) {
  const matchType = body.matchType === "ranqueada" ? "ranqueada" : "amistosa";
  if (matchType === "ranqueada" && !client.supabaseUserId) {
    return { error: "login_required" };
  }
  state.queue = state.queue.filter((entry) => entry.clientId !== client.id);
  const entry = {
    id: randomId("q_"),
    clientId: client.id,
    username: client.username,
    label: safeText(body.label, "Rápida"),
    modeKey: safeText(body.modeKey, "quick-5-0"),
    minutes: Math.max(1, Math.min(30, Number(body.minutes) || 5)),
    increment: Math.max(0, Math.min(30, Number(body.increment) || 0)),
    matchType,
    rating: Number(client.rating || body.rating || 1500),
    ratingDeviation: Number(client.ratingDeviation || body.ratingDeviation || 350),
    joinedAt: Date.now(),
  };
  state.queue.push(entry);
  client.queueEntryId = entry.id;
  pushToClient(client.id, "queue.update", { queue: queueEntryPayload(entry), stats: statsPayload() });
  emitHomeUpdate();
  const dispatchedMatches = processQueue();
  return {
    entry,
    match: dispatchedMatches.get(client.id) || null,
  };
}

function removeQueueEntry(clientId) {
  const existing = state.queue.find((entry) => entry.clientId === clientId);
  state.queue = state.queue.filter((entry) => entry.clientId !== clientId);
  const client = state.clients.get(clientId);
  if (client) client.queueEntryId = null;
  if (existing && client) {
    pushToClient(client.id, "queue.update", { queue: null, stats: statsPayload() });
  }
  emitHomeUpdate();
}

function processQueue() {
  const grouped = new Map();
  const dispatchedMatches = new Map();
  for (const entry of state.queue) {
    const groupKey = `${entry.modeKey}|${entry.matchType || "amistosa"}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(entry);
  }

  for (const entries of grouped.values()) {
    entries.sort((a, b) => a.joinedAt - b.joinedAt);
    while (entries.length) {
      const oldest = entries[0];
      const waitMs = Date.now() - oldest.joinedAt;
      let picked;
      if (oldest.matchType === "ranqueada") {
        if (entries.length < 2) break;
        const window = 120 + Math.floor(waitMs / 15_000) * 50;
        const compatible = entries.filter((entry) => Math.abs((entry.rating || 1500) - (oldest.rating || 1500)) <= window);
        if (compatible.length < 2) break;
        picked = compatible.slice(0, Math.min(compatible.length, QUICKMATCH_TARGET_PLAYERS));
        for (const entry of picked) entries.splice(entries.indexOf(entry), 1);
      } else {
        if (entries.length < 2 && waitMs < QUICKMATCH_BOT_FILL_MS) break;
        picked = entries.splice(0, Math.min(entries.length, QUICKMATCH_TARGET_PLAYERS));
      }
      for (const delivery of dispatchQueuedMatch(picked)) {
        dispatchedMatches.set(delivery.clientId, delivery.payload);
      }
    }
  }
  return dispatchedMatches;
}

function clearMatchTimer(matchId) {
  const timer = state.matchTimers.get(matchId);
  if (timer) clearTimeout(timer);
  state.matchTimers.delete(matchId);
}

function publicMatchPayload(match) {
  return {
    matchId: match.id,
    authoritative: true,
    label: match.label,
    modeKey: match.modeKey,
    minutes: match.minutes,
    increment: match.increment,
    matchType: match.matchType || "amistosa",
    playerNames: match.players.map((player) => player.name),
    humanPlayers: match.humanPlayers,
    botSeats: match.botSeats,
    botNames: match.botSeats.map((seat) => match.players[seat]?.name).filter(Boolean),
    startSeat: match.startSeat,
    autoFilledWithBots: match.botSeats.length > 0,
  };
}

function attachClientToMatch(match, client) {
  if (!match || !client) return null;
  let human = match.humanPlayers.find((player) => player.clientId === client.id);
  if (!human && client.supabaseUserId) {
    human = match.humanPlayers.find((player) => player.supabaseUserId && player.supabaseUserId === client.supabaseUserId);
  }
  if (!human) return null;

  human.clientId = client.id;
  if (client.supabaseUserId) human.supabaseUserId = client.supabaseUserId;
  if (client.username) human.username = client.username;

  const player = match.players[human.seat];
  if (player) {
    player.clientId = client.id;
    if (client.supabaseUserId) player.supabaseUserId = client.supabaseUserId;
    if (client.username) player.name = client.username;
  }
  client.activeMatchId = match.id;
  match.updatedAt = Date.now();
  return human;
}

function activeMatchPayloadForClient(client) {
  if (!client) return null;
  let match = client.activeMatchId ? state.matches.get(client.activeMatchId) : null;
  if (!match) {
    match = Array.from(state.matches.values()).find((candidate) => (
      candidate.phase !== "ended"
      && Date.now() - candidate.createdAt <= MATCH_TTL_MS
      && candidate.humanPlayers.some((player) => (
        player.clientId === client.id
        || (client.supabaseUserId && player.supabaseUserId === client.supabaseUserId)
      ))
    )) || null;
  }
  if (!match) {
    client.activeMatchId = null;
    return null;
  }
  if (!attachClientToMatch(match, client)) {
    client.activeMatchId = null;
    return null;
  }
  return {
    ...publicMatchPayload(match),
    snapshot: GameServer.viewForClient(match, client.id),
  };
}

function pushMatchSnapshot(match, eventName = "match.snapshot") {
  for (const clientId of GameServer.humanClientIds(match)) {
    pushToClient(clientId, eventName, {
      ...publicMatchPayload(match),
      snapshot: GameServer.viewForClient(match, clientId),
    });
  }
}

function scheduleAuthoritativeMatch(match) {
  clearMatchTimer(match.id);
  if (match.phase === "ended") {
    if (match.persistedAt) return;
    persistence.persistFinishedMatch(match).catch((error) => {
      console.warn("[persistence] match save failed", error.message);
      match.persistedAt = null;
    });
    return;
  }

  if (runtime.isEnabled()) return;

  if (match.phase === "resolving") {
    const timer = setTimeout(() => {
      if (!state.matches.has(match.id) || match.phase !== "resolving") return;
      GameServer.startRound(match);
      pushMatchSnapshot(match);
      scheduleAuthoritativeMatch(match);
    }, RESOLUTION_REVEAL_MS);
    state.matchTimers.set(match.id, timer);
    return;
  }

  if (match.phase !== "bidding") return;
  const actor = GameServer.currentActor(match);
  if (!actor) return;

  if (actor.isBot) {
    const delayMs = 650 + crypto.randomInt(600);
    const timer = setTimeout(() => {
      if (!state.matches.has(match.id) || match.phase !== "bidding" || match.turnSeat !== actor.seat) return;
      const action = GameServer.chooseBotAction(match, actor.seat);
      GameServer.applyAction(match, actor.seat, action);
      pushMatchSnapshot(match);
      scheduleAuthoritativeMatch(match);
    }, delayMs);
    state.matchTimers.set(match.id, timer);
    return;
  }

  const delayMs = Math.max(0, GameServer.timeRemaining(match)) + 250;
  const timer = setTimeout(() => {
    if (!state.matches.has(match.id) || match.phase !== "bidding" || match.turnSeat !== actor.seat) return;
    GameServer.resolveTimeout(match, actor.seat);
    pushMatchSnapshot(match);
    scheduleAuthoritativeMatch(match);
  }, delayMs);
  state.matchTimers.set(match.id, timer);
}

function createAuthoritativeMatch(options) {
  const match = GameServer.createMatch({
    id: options.id || randomId("m_"),
    label: options.label,
    modeKey: options.modeKey,
    minutes: options.minutes,
    increment: options.increment,
    playerNames: options.playerNames,
    humanPlayers: options.humanPlayers,
    botSeats: options.botSeats,
    startSeat: options.startSeat,
    botLevel: options.botLevel,
    matchType: options.matchType,
    config: options.config,
  });
  state.matches.set(match.id, match);
  for (const clientId of GameServer.humanClientIds(match)) {
    const client = state.clients.get(clientId);
    if (client) client.activeMatchId = match.id;
  }
  scheduleAuthoritativeMatch(match);
  return match;
}

function startRoomMatch(client, code) {
  const room = state.rooms.get(code);
  if (!room) return { error: "Sala não encontrada." };
  attachClientToExistingMember(room, client);
  if (!isRoomHost(room, client)) return { error: "Somente o host pode iniciar a sala." };
  if (room.status !== "waiting") return { error: "Essa sala já foi iniciada." };
  if (!room.members.length) return { error: "Sala vazia." };
  if (room.config.matchType === "ranqueada") {
    if (room.members.length < room.maxPlayers) return { error: "Ranqueada exige mesa completa sem bots." };
    if (!room.members.every((member) => member.supabaseUserId)) return { error: "Ranqueada exige jogadores logados." };
  }

  const humanPlayers = room.members.map((member, seat) => ({
    clientId: member.clientId,
    supabaseUserId: member.supabaseUserId || state.clients.get(member.clientId)?.supabaseUserId || null,
    username: member.username,
    seat,
  }));
  const playerNames = room.members.map((member) => member.username);
  const botSeats = [];
  while (playerNames.length < room.maxPlayers) {
    botSeats.push(playerNames.length);
    playerNames.push(BOT_NAMES[(playerNames.length - humanPlayers.length) % BOT_NAMES.length]);
  }

  room.status = "started";
  state.rooms.delete(code);
  for (const member of room.members) {
    const memberClient = state.clients.get(member.clientId);
    if (memberClient && memberClient.currentRoomCode === code) memberClient.currentRoomCode = null;
  }

  const match = createAuthoritativeMatch({
    id: randomId("m_"),
    label: room.kind === "challenge" ? "Desafio" : "Sala",
    modeKey: `${room.config.gameType}-${room.config.minutes}-${room.config.increment}`,
    minutes: room.config.minutes,
    increment: room.config.increment,
    matchType: room.config.matchType,
    playerNames,
    humanPlayers,
    botSeats,
    startSeat: crypto.randomInt(playerNames.length),
    config: {
      startingDice: 5,
      wildAces: true,
      calzaEnabled: false,
    },
  });

  for (const member of room.members) {
    pushToClient(member.clientId, "match.started", {
      ...publicMatchPayload(match),
      snapshot: GameServer.viewForClient(match, member.clientId),
    });
  }
  emitHomeUpdate();
  return { match };
}

function dispatchQueuedMatch(entries) {
  for (const entry of entries) {
    state.queue = state.queue.filter((candidate) => candidate.id !== entry.id);
    const client = state.clients.get(entry.clientId);
    if (client) client.queueEntryId = null;
  }

  const humanPlayers = entries.map((entry, i) => ({
    clientId: entry.clientId,
    supabaseUserId: state.clients.get(entry.clientId)?.supabaseUserId || null,
    username: entry.username,
    seat: i,
  }));
  const playerNames = humanPlayers.map((player) => player.username);
  const botSeats = [];
  while (entries.length === 1 && playerNames.length < QUICKMATCH_TARGET_PLAYERS) {
    botSeats.push(playerNames.length);
    playerNames.push(BOT_NAMES[(playerNames.length - humanPlayers.length) % BOT_NAMES.length]);
  }

  const match = createAuthoritativeMatch({
    id: randomId("m_"),
    label: entries[0].label,
    modeKey: entries[0].modeKey,
    minutes: entries[0].minutes,
    increment: entries[0].increment,
    matchType: entries[0].matchType || "amistosa",
    playerNames,
    humanPlayers,
    botSeats,
    startSeat: crypto.randomInt(playerNames.length),
  });

  const deliveries = [];
  for (const entry of entries) {
    const payload = {
      ...publicMatchPayload(match),
      snapshot: GameServer.viewForClient(match, entry.clientId),
    };
    pushToClient(entry.clientId, "queue.matchFound", payload);
    deliveries.push({ clientId: entry.clientId, payload });
  }

  emitHomeUpdate();
  return deliveries;
}

function advanceMatchIfDue(match, now = Date.now()) {
  let changed = false;
  let guard = 0;
  while (match && guard++ < 12) {
    const before = `${match.phase}:${match.round}:${match.seq}:${match.turnSeat}`;
    if (match.phase === "resolving") {
      if (now - (match.updatedAt || now) < RESOLUTION_REVEAL_MS) break;
      GameServer.startRound(match, now);
    } else if (match.phase === "bidding") {
      const actor = GameServer.currentActor(match);
      if (!actor) break;
      if (actor.isBot) {
        GameServer.applyAction(match, actor.seat, GameServer.chooseBotAction(match, actor.seat), now);
      } else if (GameServer.timeRemaining(match, now) <= 0) {
        GameServer.resolveTimeout(match, actor.seat, now);
      } else {
        break;
      }
    } else {
      break;
    }
    changed = true;
    match.updatedAt = now;
    if (match.phase === "ended") {
      scheduleAuthoritativeMatch(match);
      break;
    }
    if (`${match.phase}:${match.round}:${match.seq}:${match.turnSeat}` === before) break;
  }
  if (changed) runtime.markDirty();
  return changed;
}

function advanceDueMatches() {
  let changed = false;
  for (const match of state.matches.values()) {
    if (advanceMatchIfDue(match)) changed = true;
  }
  return changed;
}

function buildSnapshot(client, session = null) {
  const queuedEntry = state.queue.find((entry) => entry.clientId === client.id);
  return {
    profile: {
      clientId: client.id,
      username: client.username,
      displayName: client.displayName || "",
      avatarUrl: client.avatarUrl || "",
      supabaseUserId: client.supabaseUserId || null,
    },
    security: session ? {
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    } : null,
    links: null,
    stats: statsPayload(),
    rooms: listPublicRooms(),
    queue: queuedEntry ? queueEntryPayload(queuedEntry) : null,
    currentRoom: client.currentRoomCode && state.rooms.has(client.currentRoomCode)
      ? roomDetails(state.rooms.get(client.currentRoomCode), client)
      : null,
    activeMatch: activeMatchPayloadForClient(client),
  };
}

function cleanupState() {
  const now = Date.now();

  for (const [clientId, client] of state.clients.entries()) {
    if (now - client.lastSeenAt <= CLIENT_TTL_MS) continue;
    if (client.currentRoomCode) leaveRoom(client, client.currentRoomCode);
    removeQueueEntry(clientId);
    for (const stream of client.streams) {
      try {
        stream.end();
      } catch {}
    }
    deleteSessionsForClient(clientId);
    state.clients.delete(clientId);
  }

  for (const [code, room] of state.rooms.entries()) {
    if (room.members.length) continue;
    if (now - room.createdAt > ROOM_TTL_MS) state.rooms.delete(code);
  }

  for (const [matchId, match] of state.matches.entries()) {
    if (now - match.createdAt > MATCH_TTL_MS) {
      clearMatchTimer(matchId);
      state.matches.delete(matchId);
      for (const client of state.clients.values()) {
        if (client.activeMatchId === matchId) client.activeMatchId = null;
      }
    }
  }

  for (const [key, entry] of state.rateLimits.entries()) {
    if (now > entry.resetAt) state.rateLimits.delete(key);
  }

  for (const [sessionId, session] of state.sessions.entries()) {
    if (now > session.expiresAt || !state.clients.has(session.clientId)) {
      state.sessions.delete(sessionId);
    }
  }

  processQueue();
  emitHomeUpdate();
}

function getRoom(code) {
  return state.rooms.get(code);
}

function getMatch(matchId) {
  return state.matches.get(matchId);
}

function isQueueEntryActive(entryId) {
  return state.queue.some((entry) => entry.id === entryId);
}

module.exports = {
  statsPayload,
  roomDetails,
  listPublicRooms,
  createRoom,
  joinRoom,
  leaveRoom,
  startRoomMatch,
  deliverInvite,
  queueEntryPayload,
  upsertQueueEntry,
  removeQueueEntry,
  publicMatchPayload,
  activeMatchPayloadForClient,
  attachClientToMatch,
  pushMatchSnapshot,
  scheduleAuthoritativeMatch,
  advanceDueMatches,
  advanceMatchIfDue,
  buildSnapshot,
  cleanupState,
  getRoom,
  getMatch,
  isQueueEntryActive,
};
