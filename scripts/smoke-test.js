const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

process.env.LDA_FORCE_MEMORY_SOCIAL = "1";

const GameServer = require("../server/authoritative-game");
const Glicko = require("../server/glicko-service");
const lobby = require("../server/lobby-service");
const moderation = require("../server/moderation-service");
const persistence = require("../server/persistence-service");
const progression = require("../server/progression-service");
const qr = require("../server/qr-service");
const social = require("../server/social-service");
const state = require("../server/state");
const { handleApi } = require("../server/routes");

const ROOT = path.resolve(__dirname, "..");

function checkSyntax(relativePath) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, relativePath)], { stdio: "pipe" });
}

function checkAllSyntax() {
  for (const file of fs.readdirSync(path.join(ROOT, "server"))) {
    if (file.endsWith(".js")) checkSyntax(path.join("server", file));
  }
  for (const file of fs.readdirSync(path.join(ROOT, "api"))) {
    if (file.endsWith(".js")) checkSyntax(path.join("api", file));
  }
  for (const file of fs.readdirSync(path.join(ROOT, "js"))) {
    if (file.endsWith(".js")) checkSyntax(path.join("js", file));
  }
}

function checkAuthoritativeRound() {
  const match = GameServer.createMatch({
    id: "test_match",
    label: "Smoke",
    modeKey: "smoke-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bob"],
    humanPlayers: [
      { clientId: "alice", username: "Alice", seat: 0 },
      { clientId: "bob", username: "Bob", seat: 1 },
    ],
    botSeats: [],
    startSeat: 0,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });

  assert.equal(match.phase, "bidding");
  assert.equal(match.turnSeat, 0);

  const aliceView = GameServer.viewForClient(match, "alice");
  assert.equal(aliceView.players[0].dice.length, 5);
  assert.ok(aliceView.players[0].dice.every((die) => die >= 1 && die <= 6));
  assert.ok(aliceView.players[1].dice.every((die) => die === 0));
  assert.equal(aliceView.commitment.seedHex, null);

  const bid = GameServer.applyAction(match, 0, { type: "bid", bid: { q: 1, v: 2 } });
  assert.equal(bid.ok, true);
  assert.equal(match.turnSeat, 1);
  assert.equal(match.currentBid.q, 1);
  assert.equal(match.currentBid.v, 2);

  const dudo = GameServer.applyAction(match, 1, { type: "dudo" });
  assert.equal(dudo.ok, true);
  assert.equal(match.revealAll, true);

  const revealView = GameServer.viewForClient(match, "alice");
  assert.ok(revealView.commitment.seedHex);
  assert.ok(revealView.players[1].dice.some((die) => die > 0));
}

function resetServerState() {
  for (const timer of state.matchTimers.values()) clearTimeout(timer);
  state.clients.clear();
  state.rooms.clear();
  state.queue = [];
  state.matches.clear();
  state.matchTimers.clear();
  state.rateLimits.clear();
  state.sessions.clear();
  state.friendRequests.clear();
  state.friendships.clear();
  state.notifications.clear();
  state.auditLog.length = 0;
}

function checkActiveMatchSnapshot() {
  resetServerState();
  const client = {
    id: "alice",
    username: "Alice",
    streams: new Set(),
    lastSeenAt: Date.now(),
    activeMatchId: "active_match",
  };
  state.clients.set(client.id, client);
  const match = GameServer.createMatch({
    id: "active_match",
    label: "Reconnect",
    modeKey: "reconnect-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 0,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  state.matches.set(match.id, match);
  const snapshot = lobby.buildSnapshot(client, { csrfToken: "csrf", expiresAt: Date.now() + 1000 });
  assert.equal(snapshot.activeMatch.matchId, "active_match");
  assert.equal(snapshot.activeMatch.snapshot.matchId, "active_match");
}

async function checkDeleteMeRequiresAuth() {
  resetServerState();
  let statusCode = null;
  let payload = null;
  const req = {
    method: "DELETE",
    url: "/api/me",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = {
    writeHead(status, headers) {
      statusCode = status;
      this.headers = headers;
    },
    end(body) {
      payload = JSON.parse(body);
    },
    setHeader() {},
    getHeader() { return null; },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  let handled;
  try {
    handled = await handleApi(req, res, "/api/me");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(handled, true);
  assert.equal(statusCode, 401);
  assert.equal(payload.error, "auth_required");
}

async function checkPersistOnlyOnce() {
  resetServerState();
  const original = persistence.persistFinishedMatch;
  let calls = 0;
  persistence.persistFinishedMatch = async (match) => {
    calls += 1;
    match.persistedAt = Date.now();
    return true;
  };
  try {
    const match = { id: "ended", phase: "ended", persistedAt: null };
    lobby.scheduleAuthoritativeMatch(match);
    lobby.scheduleAuthoritativeMatch(match);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1);
  } finally {
    persistence.persistFinishedMatch = original;
  }
}

function mockResponse() {
  return {
    statusCode: null,
    headers: {},
    payload: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...(headers || {}) };
    },
    end(body) {
      try {
        this.payload = body ? JSON.parse(body) : null;
      } catch {
        this.payload = body || null;
      }
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()] || null;
    },
  };
}

async function callApi({ method = "GET", url, headers = {}, body = null }) {
  let statusCode = null;
  const req = body == null
    ? new Readable({ read() { this.push(null); } })
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: "127.0.0.1" };
  if (body != null) {
    req.headers["content-type"] = "application/json";
  }
  const res = mockResponse();
  const pathname = new URL(url, "http://localhost").pathname;
  const handled = await handleApi(req, res, pathname);
  statusCode = res.statusCode;
  return { handled, statusCode, payload: res.payload, headers: res.headers };
}

async function checkSnapshotMatchAndReports() {
  resetServerState();
  const client = {
    id: "alice",
    username: "Alice",
    displayName: "",
    avatarUrl: "",
    supabaseUserId: null,
    streams: new Set(),
    lastSeenAt: Date.now(),
    activeMatchId: "active_match",
    notifications: [],
  };
  const session = {
    id: "s_test",
    clientId: client.id,
    csrfToken: "csrf_test",
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + 1000,
  };
  state.clients.set(client.id, client);
  state.sessions.set(session.id, session);
  const cookie = `lda_session=${require("../server/session-service").getSessionFromRequest ? "" : ""}`;
  const signed = require("node:crypto")
    .createHmac("sha256", process.env.SESSION_SECRET || require("../server/config").SESSION_SECRET)
    .update(session.id)
    .digest("base64url");
  const authHeaders = { cookie: `lda_session=${session.id}.${signed}` };
  const match = GameServer.createMatch({
    id: "active_match",
    label: "Polling",
    modeKey: "poll-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 0,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  state.matches.set(match.id, match);

  const snapshot = await callApi({ url: "/api/snapshot", headers: authHeaders });
  assert.equal(snapshot.handled, true);
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.payload.activeMatch.matchId, "active_match");

  const matchResponse = await callApi({ url: "/api/match/active_match", headers: authHeaders });
  assert.equal(matchResponse.statusCode, 200);
  assert.equal(matchResponse.payload.snapshot.matchId, "active_match");

  const invalidReport = await callApi({
    method: "POST",
    url: "/api/reports",
    headers: { ...authHeaders, "x-csrf-token": "csrf_test" },
    body: { reason: "" },
  });
  assert.equal(invalidReport.statusCode, 400);

  const blockedReport = await callApi({
    method: "POST",
    url: "/api/reports",
    headers: { ...authHeaders, "x-csrf-token": "csrf_test" },
    body: { targetUsername: "Bob", reason: "abuse", details: "discord.gg/test" },
  });
  assert.equal(blockedReport.statusCode, 400);

  const report = await callApi({
    method: "POST",
    url: "/api/reports",
    headers: { ...authHeaders, "x-csrf-token": "csrf_test" },
    body: { targetUsername: "Bob", reason: "abuse", details: "test" },
  });
  assert.equal(report.statusCode, 200);
  assert.equal(report.payload.ok, true);
}

function checkLazyProgression() {
  resetServerState();
  const botMatch = GameServer.createMatch({
    id: "lazy_bot",
    label: "Bot",
    modeKey: "bot-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 1,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  state.matches.set(botMatch.id, botMatch);
  lobby.advanceDueMatches();
  assert.notEqual(botMatch.turnSeat, 1);

  const timeoutMatch = GameServer.createMatch({
    id: "lazy_timeout",
    label: "Timeout",
    modeKey: "timeout-1-0",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bob"],
    humanPlayers: [
      { clientId: "alice", username: "Alice", seat: 0 },
      { clientId: "bob", username: "Bob", seat: 1 },
    ],
    botSeats: [],
    startSeat: 0,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  timeoutMatch.players[0].timeLeftMs = 0;
  timeoutMatch.clock.deadlineAt = Date.now() - 1;
  state.matches.set(timeoutMatch.id, timeoutMatch);
  lobby.advanceDueMatches();
  assert.equal(timeoutMatch.phase, "resolving");
  assert.equal(timeoutMatch.lastAction.type, "timeout");
}

async function checkHealthProductionReadyFlag() {
  resetServerState();
  const health = await callApi({ url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.payload.productionReady, false);
  assert.equal(typeof health.payload.version, "string");
}

function signedCookie(sessionId) {
  const signed = require("node:crypto")
    .createHmac("sha256", process.env.SESSION_SECRET || require("../server/config").SESSION_SECRET)
    .update(sessionId)
    .digest("base64url");
  return `lda_session=${sessionId}.${signed}`;
}

function addAuthedClient({ id, username, profileId, csrf }) {
  const client = {
    id,
    username,
    displayName: "",
    avatarUrl: "",
    supabaseUserId: profileId,
    rating: 1500,
    ratingDeviation: 350,
    level: 1,
    xp: 0,
    streams: new Set(),
    lastSeenAt: Date.now(),
    activeMatchId: null,
    notifications: [],
  };
  const session = {
    id: `s_${id}`,
    clientId: id,
    csrfToken: csrf,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  state.clients.set(client.id, client);
  state.sessions.set(session.id, session);
  return {
    client,
    session,
    headers: { cookie: signedCookie(session.id), "x-csrf-token": csrf },
    getHeaders: { cookie: signedCookie(session.id) },
  };
}

async function checkFriendsAndNotifications() {
  resetServerState();
  const alice = addAuthedClient({ id: "alice", username: "alice", profileId: "p_alice", csrf: "csrf_a" });
  const bob = addAuthedClient({ id: "bob", username: "bob", profileId: "p_bob", csrf: "csrf_b" });
  const carla = addAuthedClient({ id: "carla", username: "carla", profileId: "p_carla", csrf: "csrf_c" });

  const request = await callApi({
    method: "POST",
    url: "/api/friends/request",
    headers: alice.headers,
    body: { username: "bob" },
  });
  assert.equal(request.statusCode, 200);
  assert.equal(request.payload.request.status, "pending");

  const bobNotifications = await callApi({ url: "/api/notifications", headers: bob.getHeaders });
  assert.equal(bobNotifications.payload.unread, 1);
  assert.equal(bobNotifications.payload.notifications[0].type, "friend_request");

  const accept = await callApi({
    method: "POST",
    url: `/api/friends/requests/${request.payload.request.id}/respond`,
    headers: bob.headers,
    body: { response: "accept" },
  });
  assert.equal(accept.statusCode, 200);
  assert.equal(accept.payload.request.status, "accepted");

  const aliceFriends = await callApi({ url: "/api/friends", headers: alice.getHeaders });
  assert.equal(aliceFriends.payload.friends.length, 1);
  assert.equal(aliceFriends.payload.friends[0].username, "bob");

  const carlaRequest = await callApi({
    method: "POST",
    url: "/api/friends/request",
    headers: carla.headers,
    body: { username: "bob" },
  });
  const decline = await callApi({
    method: "POST",
    url: `/api/friends/requests/${carlaRequest.payload.request.id}/respond`,
    headers: bob.headers,
    body: { response: "decline" },
  });
  assert.equal(decline.payload.request.status, "declined");
  const retry = await callApi({
    method: "POST",
    url: "/api/friends/request",
    headers: carla.headers,
    body: { username: "bob" },
  });
  assert.equal(retry.statusCode, 400);
  assert.equal(retry.payload.error, "friend_cooldown");

  const readAll = await callApi({ method: "POST", url: "/api/notifications/read-all", headers: bob.headers, body: {} });
  assert.equal(readAll.statusCode, 200);
  const noUnread = await callApi({ url: "/api/notifications", headers: bob.getHeaders });
  assert.equal(noUnread.payload.unread, 0);
}

function checkRankedMatchmaking() {
  resetServerState();
  const guest = { id: "guest", username: "guest", streams: new Set(), lastSeenAt: Date.now(), supabaseUserId: null };
  state.clients.set(guest.id, guest);
  const guestRanked = lobby.upsertQueueEntry(guest, { matchType: "ranqueada", modeKey: "quick-5-0", minutes: 5, increment: 0 });
  assert.equal(guestRanked.error, "login_required");

  resetServerState();
  const low = addAuthedClient({ id: "low", username: "low", profileId: "p_low", csrf: "csrf_low" });
  const high = addAuthedClient({ id: "high", username: "high", profileId: "p_high", csrf: "csrf_high" });
  low.client.rating = 1500;
  high.client.rating = 1900;
  lobby.upsertQueueEntry(low.client, { matchType: "ranqueada", modeKey: "quick-5-0", minutes: 5, increment: 0 });
  const far = lobby.upsertQueueEntry(high.client, { matchType: "ranqueada", modeKey: "quick-5-0", minutes: 5, increment: 0 });
  assert.equal(far.match, null);
  assert.equal(state.queue.length, 2);

  resetServerState();
  const alice = addAuthedClient({ id: "rank_a", username: "rank_a", profileId: "p_rank_a", csrf: "csrf_ra" });
  const bob = addAuthedClient({ id: "rank_b", username: "rank_b", profileId: "p_rank_b", csrf: "csrf_rb" });
  alice.client.rating = 1500;
  bob.client.rating = 1560;
  lobby.upsertQueueEntry(alice.client, { matchType: "ranqueada", modeKey: "quick-5-0", minutes: 5, increment: 0 });
  const matched = lobby.upsertQueueEntry(bob.client, { matchType: "ranqueada", modeKey: "quick-5-0", minutes: 5, increment: 0 });
  assert.equal(matched.match.matchType, "ranqueada");
  assert.equal(matched.match.autoFilledWithBots, false);
  resetServerState();
}

async function checkQrModerationProgressionAndGlicko() {
  const svg = await qr.svgForText("https://example.test/invite/abc");
  assert.ok(svg.includes("<svg"));
  assert.equal(moderation.validateText("normal player", { allowEmpty: false }).ok, true);
  assert.equal(moderation.validateText("discord.gg/test", { allowEmpty: false }).ok, false);
  assert.equal(moderation.validateText("shit", { allowEmpty: false }).ok, false);

  const p = progression.progressForXp(400);
  assert.equal(p.level, 3);
  assert.equal(progression.xpAwardForMatch({ players: [1, 2, 3, 4] }, "win", true, 3), 125);

  const updates = Glicko.updateMatchRatings([
    { id: "a", result: "win", rating: 1500, ratingDeviation: 350, ratingVolatility: 0.06 },
    { id: "b", result: "loss", rating: 1500, ratingDeviation: 350, ratingVolatility: 0.06 },
  ]);
  const alice = updates.find((item) => item.id === "a");
  const bob = updates.find((item) => item.id === "b");
  assert.ok(alice.after.rating > alice.before.rating);
  assert.ok(bob.after.rating < bob.before.rating);
}

function checkSettingsAndAudio() {
  const code = fs.readFileSync(path.join(ROOT, "js", "app.settings.js"), "utf8");
  const storage = new Map();
  const classes = new Set();
  const elements = new Map();
  let toneStarts = 0;
  const app = {
    state: {},
    $(selector) {
      if (!selector.startsWith("#")) return null;
      const id = selector.slice(1);
      if (!elements.has(id)) elements.set(id, { checked: false, value: "", addEventListener() {} });
      return elements.get(id);
    },
    openDialog(title, html) {
      this.lastDialog = { title, html };
    },
  };
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: { value: 0 },
        connect() {},
        start() { toneStarts += 1; },
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    }
  }
  vm.runInNewContext(code, {
    window: {
      LDAApp: app,
      AudioContext: FakeAudioContext,
      setTimeout(fn) {
        fn();
        return 1;
      },
    },
    document: {
      body: {
        classList: {
          toggle(name, enabled) {
            if (enabled) classes.add(name);
            else classes.delete(name);
          },
        },
      },
    },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    console,
  });

  app.saveSettings({ volume: 0.25, muted: false, start3d: true, reduceMotion: true, compactUi: true });
  assert.equal(JSON.parse(storage.get("lda.settings")).start3d, true);
  assert.equal(elements.get("cfg-3d").checked, true);
  assert.equal(classes.has("reduce-motion"), true);
  assert.equal(classes.has("compact-ui"), true);
  app.playSound("notification");
  assert.ok(toneStarts > 0);
  toneStarts = 0;
  app.saveSettings({ volume: 0, muted: true });
  app.playSound("notification");
  assert.equal(toneStarts, 0);
}

function checkBotLevelsDifferent() {
  const match = GameServer.createMatch({
    id: "bot_levels",
    label: "Bot Levels",
    modeKey: "bot-levels",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 1,
    config: { startingDice: 5, wildAces: true, calzaEnabled: true },
  });
  match.currentBid = { q: 2, v: 6, seat: 0 };
  match.players[1].hand = [1, 2, 3, 4, 5];
  match.turnSeat = 1;
  match.players[1].botLevel = 5;
  const level5 = GameServer.chooseBotAction(match, 1);
  match.players[1].botLevel = 8;
  const level8 = GameServer.chooseBotAction(match, 1);
  assert.notDeepEqual(level8, level5);

  const pressure = GameServer.createMatch({
    id: "bot_pressure",
    label: "Bot Pressure",
    modeKey: "bot-pressure",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 1,
    botLevel: 8,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  pressure.players[1].hand = [1, 1, 6, 3, 4];
  pressure.turnSeat = 1;
  const opening = GameServer.chooseBotAction(pressure, 1);
  assert.equal(opening.type, "bid");
  assert.ok(opening.bid.q >= 4);

  const trap = GameServer.createMatch({
    id: "bot_dudo",
    label: "Bot Dudo",
    modeKey: "bot-dudo",
    minutes: 1,
    increment: 0,
    playerNames: ["Alice", "Bot"],
    humanPlayers: [{ clientId: "alice", username: "Alice", seat: 0 }],
    botSeats: [1],
    startSeat: 1,
    botLevel: 8,
    config: { startingDice: 5, wildAces: true, calzaEnabled: false },
  });
  trap.currentBid = { q: 3, v: 6, seat: 0 };
  trap.bidHistory = [{ seat: 0, q: 3, v: 6 }];
  trap.players[1].hand = [2, 3, 4, 5, 2];
  trap.turnSeat = 1;
  assert.deepEqual(GameServer.chooseBotAction(trap, 1), { type: "dudo" });
}

function checkClientBotLevel8Strength() {
  const code = [
    fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8"),
    fs.readFileSync(path.join(ROOT, "js", "bot.js"), "utf8"),
    `
    const state = Game.newMatch({ playerNames: ["Humano", "Bot"], startingDice: 5, wildAces: true, calzaEnabled: false, matchId: "client-bot" });
    state.phase = "bidding";
    state.turnSeat = 1;
    state.players[0].dice = [0, 0, 0, 0, 0];
    state.players[1].dice = [2, 3, 4, 5, 2];
    state.currentBid = { q: 3, v: 6, seat: 0 };
    state.bidHistory = [{ seat: 0, q: 3, v: 6 }];
    this.__dudo = Bot.chooseAction(state, 1, 8);
    state.currentBid = null;
    state.bidHistory = [];
    state.players[1].dice = [1, 1, 6, 3, 4];
    this.__opening = Bot.chooseAction(state, 1, 8);
    `,
  ].join("\n");
  const context = { console, Math };
  vm.runInNewContext(code, context);
  assert.equal(context.__dudo.type, "dudo");
  assert.equal(context.__opening.type, "bid");
  assert.ok(context.__opening.bid.q >= 4);
}

async function main() {
  checkAllSyntax();
  checkAuthoritativeRound();
  checkActiveMatchSnapshot();
  await checkDeleteMeRequiresAuth();
  await checkPersistOnlyOnce();
  await checkSnapshotMatchAndReports();
  await checkFriendsAndNotifications();
  checkRankedMatchmaking();
  await checkQrModerationProgressionAndGlicko();
  checkSettingsAndAudio();
  checkBotLevelsDifferent();
  checkClientBotLevel8Strength();
  checkLazyProgression();
  await checkHealthProductionReadyFlag();
  console.log("Smoke tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
