const crypto = require("node:crypto");

const BOT_LEVEL_DEFAULT = 3;

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function sha256Hex(buffer) {
  return sha256(buffer).toString("hex");
}

function hmac(key, message) {
  return crypto.createHmac("sha256", key).update(message).digest();
}

function deriveFinalSeed(serverSeed, matchId, round) {
  return sha256(Buffer.concat([
    serverSeed,
    Buffer.from(`|${matchId}|${round}`, "utf8"),
  ]));
}

function rollDieFor(finalSeed, playerId, dieIndex) {
  const mac = hmac(finalSeed, Buffer.from(`dice|${playerId}|${dieIndex}`, "utf8"));
  for (const byte of mac) {
    if (byte < 252) return 1 + (byte % 6);
  }
  return 1 + (mac[0] % 6);
}

function rollHand(finalSeed, playerId, count) {
  const hand = [];
  for (let index = 0; index < count; index++) {
    hand.push(rollDieFor(finalSeed, playerId, index));
  }
  return hand;
}

function derivePhysicsSeed(finalSeed) {
  const mac = hmac(finalSeed, Buffer.from("physics", "utf8"));
  return mac.readUInt32BE(0);
}

function totalDiceInPool(match) {
  return match.players.reduce((sum, player) => sum + (player.alive ? player.diceCount : 0), 0);
}

function alivePlayers(match) {
  return match.players.filter((player) => player.alive);
}

function nextAliveSeat(match, fromSeat) {
  const total = match.players.length;
  for (let step = 1; step <= total; step++) {
    const seat = (fromSeat + step) % total;
    if (match.players[seat]?.alive) return seat;
  }
  return fromSeat;
}

function isValidRaise(prev, next) {
  if (!next || typeof next.q !== "number" || typeof next.v !== "number") return false;
  if (next.q < 1 || next.v < 1 || next.v > 6) return false;
  if (!prev) return true;
  if (next.q > prev.q) return true;
  return next.q === prev.q && next.v > prev.v;
}

function minRaiseForValue(prev, value) {
  if (!prev) return { q: 1, v: value };
  if (value > prev.v) return { q: prev.q, v: value };
  return { q: prev.q + 1, v: value };
}

function countInPool(match, value) {
  let count = 0;
  for (const player of match.players) {
    if (!player.alive) continue;
    for (const die of player.hand) {
      if (die === value) count++;
      else if (match.config.wildAces && value !== 1 && die === 1) count++;
    }
  }
  return count;
}

function snapshotHands(match) {
  return match.players.map((player) => ({
    seat: player.seat,
    name: player.name,
    dice: player.hand.slice(),
    alive: player.alive,
    diceCount: player.diceCount,
  }));
}

function addLog(match, type, text, details = {}) {
  match.log.push({
    seq: ++match.seq,
    type,
    text,
    at: Date.now(),
    ...details,
  });
  if (match.log.length > 160) match.log = match.log.slice(-160);
}

function createMatch(options) {
  const minutes = clampNumber(options.minutes, 1, 30, 5);
  const increment = clampNumber(options.increment, 0, 30, 0);
  const startingDice = clampNumber(options.config?.startingDice, 1, 7, 5);
  const turnTimeMs = minutes * 60_000;
  const incrementMs = increment * 1000;
  const humanSeats = new Map((options.humanPlayers || []).map((player) => [player.seat, player]));
  const botSeatSet = new Set(options.botSeats || []);

  const match = {
    id: options.id,
    label: options.label || "Rápida",
    modeKey: options.modeKey || "quick-5-0",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    authoritative: true,
    seq: 0,
    phase: "lobby",
    round: 0,
    turnSeat: 0,
    startSeat: Number.isInteger(options.startSeat) ? options.startSeat : 0,
    currentBid: null,
    bidHistory: [],
    winnerSeat: null,
    revealAll: false,
    lastAction: null,
    commitment: null,
    clock: { turnSeat: null, deadlineAt: 0, startedRemainingMs: turnTimeMs },
    turnTimeMs,
    incrementMs,
    minutes,
    increment,
    config: {
      startingDice,
      wildAces: options.config?.wildAces !== false,
      calzaEnabled: options.config?.calzaEnabled === true,
    },
    players: options.playerNames.map((name, seat) => {
      const human = humanSeats.get(seat);
      return {
        id: seat,
        seat,
        clientId: human ? human.clientId : null,
        supabaseUserId: human ? human.supabaseUserId || null : null,
        name,
        isBot: botSeatSet.has(seat),
        botLevel: botSeatSet.has(seat) ? clampNumber(options.botLevel, 1, 8, BOT_LEVEL_DEFAULT) : 0,
        alive: true,
        diceCount: startingDice,
        hand: [],
        timeLeftMs: turnTimeMs,
        lastActionTimeMs: turnTimeMs,
      };
    }),
    humanPlayers: (options.humanPlayers || []).map((player) => ({ ...player })),
    botSeats: Array.from(botSeatSet),
    rounds: [],
    log: [],
  };

  addLog(match, "round", `Partida iniciada com ${match.players.length} jogadores.`);
  startRound(match, Date.now());
  return match;
}

function startRound(match, now = Date.now()) {
  match.round += 1;
  match.phase = "bidding";
  match.currentBid = null;
  match.bidHistory = [];
  match.revealAll = false;
  match.lastAction = null;
  match.updatedAt = now;

  const serverSeed = crypto.randomBytes(32);
  const hashHex = sha256Hex(serverSeed);
  const finalSeed = deriveFinalSeed(serverSeed, match.id, match.round);
  const physicsSeed = derivePhysicsSeed(finalSeed);

  match.commitment = {
    hashHex,
    seedHex: serverSeed.toString("hex"),
    finalSeedHex: finalSeed.toString("hex"),
    physicsSeed,
    revealed: false,
    clientSeeds: [],
  };

  for (const player of match.players) {
    player.hand = player.alive ? rollHand(finalSeed, player.id, player.diceCount) : [];
  }

  if (!match.players[match.startSeat]?.alive) {
    match.startSeat = nextAliveSeat(match, match.startSeat);
  }
  match.turnSeat = match.startSeat;
  match.rounds.push({
    number: match.round,
    startedAlive: alivePlayers(match).map((player) => player.seat),
    hands: snapshotHands(match),
    bids: [],
    outcome: null,
    commitmentHash: hashHex,
    serverSeedReveal: null,
    physicsSeed,
  });
  addLog(match, "round", `Round ${match.round}: compromisso sha256:${hashHex.slice(0, 12)}...`);
  beginTurn(match, now);
}

function beginTurn(match, now = Date.now()) {
  if (match.phase !== "bidding") return;
  const player = match.players[match.turnSeat];
  if (!player || !player.alive) {
    match.turnSeat = nextAliveSeat(match, match.turnSeat);
    return beginTurn(match, now);
  }
  const remaining = Math.max(0, player.timeLeftMs);
  match.clock = {
    turnSeat: player.seat,
    deadlineAt: now + remaining,
    startedRemainingMs: remaining,
  };
  match.updatedAt = now;
}

function timeRemaining(match, now = Date.now()) {
  if (match.phase !== "bidding" || match.clock.turnSeat == null) return 0;
  return Math.max(0, match.clock.deadlineAt - now);
}

function commitActionTime(match, seat, now = Date.now(), applyIncrement = true) {
  const player = match.players[seat];
  if (!player) return 0;
  const remaining = match.clock.turnSeat === seat ? timeRemaining(match, now) : player.timeLeftMs;
  const next = Math.max(0, remaining + (applyIncrement ? match.incrementMs : 0));
  player.timeLeftMs = next;
  player.lastActionTimeMs = next;
  match.clock = { turnSeat: null, deadlineAt: 0, startedRemainingMs: next };
  return next;
}

function placeBid(match, seat, bid, now = Date.now()) {
  if (match.phase !== "bidding") return { ok: false, error: "phase" };
  if (match.turnSeat !== seat) return { ok: false, error: "not-your-turn" };
  const normalized = { q: Number(bid?.q), v: Number(bid?.v) };
  if (!isValidRaise(match.currentBid, normalized)) return { ok: false, error: "invalid-raise" };
  if (normalized.q > totalDiceInPool(match)) return { ok: false, error: "above-pool" };

  const timeLeftMs = commitActionTime(match, seat, now, true);
  const entry = { type: "bid", seat, q: normalized.q, v: normalized.v, timeLeftMs };
  match.currentBid = { q: normalized.q, v: normalized.v, seat, timeLeftMs };
  match.bidHistory.push(entry);
  currentRound(match).bids.push(entry);
  match.lastAction = { type: "bid", seat, bid: { q: normalized.q, v: normalized.v }, timeLeftMs };
  addLog(match, "bid", `${match.players[seat].name} fez lance ${normalized.q}x${normalized.v}.`, {
    seat,
    bid: { q: normalized.q, v: normalized.v },
    timeLeftMs,
  });
  match.turnSeat = nextAliveSeat(match, seat);
  beginTurn(match, now);
  return { ok: true, resolved: false };
}

function resolveDudo(match, challengerSeat, now = Date.now()) {
  if (match.phase !== "bidding") return { ok: false, error: "phase" };
  if (match.turnSeat !== challengerSeat) return { ok: false, error: "not-your-turn" };
  if (!match.currentBid) return { ok: false, error: "no-bid" };

  const timeLeftMs = commitActionTime(match, challengerSeat, now, true);
  currentRound(match).bids.push({ type: "dudo", seat: challengerSeat, timeLeftMs });

  const bid = match.currentBid;
  const real = countInPool(match, bid.v);
  const claimTrue = real >= bid.q;
  const loserSeat = claimTrue ? challengerSeat : bid.seat;
  const revealedHands = snapshotHands(match);
  const loser = match.players[loserSeat];
  if (loser.diceCount > 0) loser.diceCount -= 1;
  if (loser.diceCount <= 0) loser.alive = false;

  const outcome = {
    type: "dudo_resolved",
    challengerSeat,
    bid: { ...bid },
    real,
    claimTrue,
    loserSeat,
    eliminatedSeat: loser.alive ? null : loserSeat,
    hands: revealedHands,
  };
  finishRound(match, outcome, loserSeat, now);
  match.lastAction = { type: "dudo", seat: challengerSeat, bid: { ...bid }, timeLeftMs };
  addLog(match, "dudo", `${match.players[challengerSeat].name} chamou Dudo. Real=${real}; ${match.players[loserSeat].name} perde 1 dado.`);
  return { ok: true, resolved: true, outcome };
}

function resolveCalza(match, callerSeat, now = Date.now()) {
  if (!match.config.calzaEnabled) return { ok: false, error: "calza-disabled" };
  if (match.phase !== "bidding") return { ok: false, error: "phase" };
  if (match.turnSeat !== callerSeat) return { ok: false, error: "not-your-turn" };
  if (!match.currentBid) return { ok: false, error: "no-bid" };

  const timeLeftMs = commitActionTime(match, callerSeat, now, true);
  currentRound(match).bids.push({ type: "calza", seat: callerSeat, timeLeftMs });

  const bid = match.currentBid;
  const real = countInPool(match, bid.v);
  const exact = real === bid.q;
  const caller = match.players[callerSeat];
  const revealedHands = snapshotHands(match);
  if (exact) {
    caller.diceCount = Math.min(match.config.startingDice, caller.diceCount + 1);
  } else {
    caller.diceCount -= 1;
    if (caller.diceCount <= 0) caller.alive = false;
  }

  const outcome = {
    type: "calza_resolved",
    callerSeat,
    bid: { ...bid },
    real,
    exact,
    eliminatedSeat: caller.alive ? null : callerSeat,
    hands: revealedHands,
  };
  finishRound(match, outcome, callerSeat, now);
  match.lastAction = { type: "calza", seat: callerSeat, bid: { ...bid }, timeLeftMs };
  addLog(match, "calza", `${caller.name} chamou Calza. Real=${real}; ${exact ? "acertou" : "errou"}.`);
  return { ok: true, resolved: true, outcome };
}

function resolveTimeout(match, timedOutSeat, now = Date.now()) {
  if (match.phase !== "bidding") return { ok: false, error: "phase" };
  if (match.turnSeat !== timedOutSeat) return { ok: false, error: "not-your-turn" };

  commitActionTime(match, timedOutSeat, now, false);
  const player = match.players[timedOutSeat];
  const revealedHands = snapshotHands(match);
  if (player.diceCount > 0) player.diceCount -= 1;
  if (player.diceCount <= 0) player.alive = false;

  const bid = match.currentBid ? { ...match.currentBid } : null;
  currentRound(match).bids.push({ type: "timeout", seat: timedOutSeat, timeLeftMs: 0 });
  const outcome = {
    type: "timeout_resolved",
    timedOutSeat,
    loserSeat: timedOutSeat,
    bid,
    eliminatedSeat: player.alive ? null : timedOutSeat,
    hands: revealedHands,
  };
  finishRound(match, outcome, timedOutSeat, now);
  match.lastAction = { type: "timeout", seat: timedOutSeat, bid, timeLeftMs: 0 };
  addLog(match, "timeout", `${player.name} ficou sem tempo e perde 1 dado.`);
  return { ok: true, resolved: true, outcome };
}

function finishRound(match, outcome, nextStarterSeat, now = Date.now()) {
  const round = currentRound(match);
  round.outcome = outcome;
  round.serverSeedReveal = match.commitment.seedHex;
  match.commitment.revealed = true;
  match.revealAll = true;
  match.updatedAt = now;

  const alive = alivePlayers(match);
  if (alive.length <= 1) {
    match.phase = "ended";
    match.winnerSeat = alive.length === 1 ? alive[0].seat : null;
    match.clock = { turnSeat: null, deadlineAt: 0, startedRemainingMs: 0 };
    addLog(match, "end", `Partida encerrada. Vencedor: ${match.winnerSeat == null ? "-" : match.players[match.winnerSeat].name}.`);
    return;
  }

  const starter = match.players[nextStarterSeat];
  match.startSeat = starter?.alive ? nextStarterSeat : nextAliveSeat(match, nextStarterSeat);
  match.phase = "resolving";
  match.clock = { turnSeat: null, deadlineAt: 0, startedRemainingMs: 0 };
}

function applyAction(match, seat, action, now = Date.now()) {
  if (!match.players[seat]?.alive) return { ok: false, error: "player-dead" };
  if (action?.type === "bid") return placeBid(match, seat, action.bid, now);
  if (action?.type === "dudo") return resolveDudo(match, seat, now);
  if (action?.type === "calza") return resolveCalza(match, seat, now);
  return { ok: false, error: "unknown-action" };
}

function currentRound(match) {
  return match.rounds[match.rounds.length - 1];
}

function binomTail(n, k, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const q = 1 - p;
  let pi = Math.pow(q, n);
  let cumLess = pi;
  for (let i = 1; i < k; i++) {
    pi = pi * (n - i + 1) / i * (p / q);
    cumLess += pi;
  }
  return Math.max(0, Math.min(1, 1 - cumLess));
}

function probBidTrue(ownDice, totalPool, bid, wildAces) {
  const own = ownDice.reduce((count, die) => count + (die === bid.v || (wildAces && bid.v !== 1 && die === 1) ? 1 : 0), 0);
  const unknown = totalPool - ownDice.length;
  const needed = bid.q - own;
  if (needed <= 0) return 1;
  if (unknown <= 0) return 0;
  const p = bid.v === 1 ? (1 / 6) : (wildAces ? (2 / 6) : (1 / 6));
  return binomTail(unknown, needed, p);
}

function enumerateRaises(match) {
  const prev = match.currentBid;
  const pool = totalDiceInPool(match);
  const raises = [];
  for (let v = 1; v <= 6; v++) {
    const min = minRaiseForValue(prev, v).q;
    const maxReasonable = Math.min(pool, prev ? prev.q + 4 : Math.ceil(pool * 0.6));
    for (let q = min; q <= maxReasonable; q++) {
      if (isValidRaise(prev, { q, v })) raises.push({ q, v });
    }
  }
  return raises;
}

function chooseBotAction(match, seat) {
  const player = match.players[seat];
  const level = player.botLevel || BOT_LEVEL_DEFAULT;
  const prev = match.currentBid;
  const raises = enumerateRaises(match);
  if (!raises.length) return { type: "dudo" };

  if (level <= 1) {
    if (prev && crypto.randomInt(100) < 25) return { type: "dudo" };
    return { type: "bid", bid: raises[crypto.randomInt(raises.length)] };
  }

  const pool = totalDiceInPool(match);
  const wild = match.config.wildAces;
  let best = null;
  for (const bid of raises) {
    const p = probBidTrue(player.hand, pool, bid, wild);
    let score = p;
    if (level >= 5 && p > 0.28 && p < 0.5) {
      score += 0.15 * (0.4 - Math.abs(p - 0.4));
    }
    if (bid.q > pool * 0.75) score -= 0.15;
    if (!best || score > best.score) best = { bid, score, p };
  }

  if (prev) {
    const pTrue = probBidTrue(player.hand, pool, prev, wild);
    const dudoScore = 1 - pTrue;
    const threshold = level >= 5 ? 0.58 : 0.62;
    if (dudoScore > threshold && dudoScore > (best?.score || -1) + 0.05) {
      return { type: "dudo" };
    }
  }

  return { type: "bid", bid: best.bid };
}

function viewForClient(match, clientId) {
  const self = match.players.find((player) => player.clientId === clientId) || null;
  const selfSeat = self ? self.seat : null;
  const now = Date.now();
  return {
    matchId: match.id,
    authoritative: true,
    seq: match.seq,
    label: match.label,
    modeKey: match.modeKey,
    phase: match.phase,
    round: match.round,
    selfSeat,
    turnSeat: match.turnSeat,
    startSeat: match.startSeat,
    winnerSeat: match.winnerSeat,
    revealAll: match.revealAll || match.phase === "ended",
    currentBid: match.currentBid ? { ...match.currentBid } : null,
    bidHistory: match.bidHistory.map((bid) => ({ ...bid })),
    lastAction: match.lastAction ? { ...match.lastAction } : null,
    turnTimeMs: match.turnTimeMs,
    incrementMs: match.incrementMs,
    minutes: match.minutes,
    increment: match.increment,
    config: { ...match.config },
    clock: {
      turnSeat: match.clock.turnSeat,
      timeRemainingMs: timeRemaining(match, now),
      deadlineAt: match.clock.deadlineAt,
    },
    commitment: match.commitment ? {
      hashHex: match.commitment.hashHex,
      seedHex: match.commitment.revealed ? match.commitment.seedHex : null,
      clientSeeds: match.commitment.clientSeeds,
      physicsSeed: match.commitment.physicsSeed,
      finalSeedHex: match.commitment.revealed ? match.commitment.finalSeedHex : null,
      revealed: match.commitment.revealed,
    } : null,
    players: match.players.map((player) => {
      const canSee = player.seat === selfSeat || match.revealAll || match.phase === "ended";
      const dice = canSee ? player.hand.slice() : new Array(player.diceCount).fill(0);
      return {
        seat: player.seat,
        name: player.name,
        isBot: player.isBot,
        botLevel: player.botLevel,
        alive: player.alive,
        diceCount: player.diceCount,
        dice,
        timeLeftMs: match.clock.turnSeat === player.seat ? timeRemaining(match, now) : player.timeLeftMs,
        lastActionTimeMs: player.lastActionTimeMs,
      };
    }),
    rounds: match.rounds.map((round) => ({
      ...round,
      hands: round.outcome || match.revealAll || match.phase === "ended" ? round.hands : [],
    })),
    log: match.log.slice(-120),
  };
}

function humanClientIds(match) {
  return match.players
    .filter((player) => player.clientId)
    .map((player) => player.clientId);
}

function currentActor(match) {
  return match.phase === "bidding" ? match.players[match.turnSeat] || null : null;
}

module.exports = {
  createMatch,
  startRound,
  applyAction,
  resolveTimeout,
  chooseBotAction,
  viewForClient,
  humanClientIds,
  currentActor,
  timeRemaining,
  totalDiceInPool,
  isValidRaise,
};
